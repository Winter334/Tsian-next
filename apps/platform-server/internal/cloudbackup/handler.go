package cloudbackup

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"tsian/platform-server/internal/storage"
	"tsian/platform-server/internal/user"
)

var sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Handler struct {
	repo      Repository
	blobStore storage.BlobStore
}

type errorBody struct {
	Error string `json:"error"`
}

type fileEntryRequest struct {
	Path      string   `json:"path"`
	Hash      string   `json:"hash"`
	Size      int64    `json:"size"`
	MediaType string   `json:"mediaType"`
	Kind      FileKind `json:"kind"`
	CreatedAt int64    `json:"createdAt"`
	UpdatedAt int64    `json:"updatedAt"`
}

type backupRequest struct {
	BackupID           string             `json:"backupId"`
	ExpectedRevisionID *string            `json:"expectedRevisionId"`
	Force              bool               `json:"force"`
	Name               string             `json:"name"`
	CardID             string             `json:"cardId"`
	CardVersion        string             `json:"cardVersion"`
	Files              []fileEntryRequest `json:"files"`
}

type prepareResponse struct {
	BackupID              string   `json:"backupId"`
	MissingHashes         []string `json:"missingHashes"`
	UsageBytesAfterCommit int64    `json:"usageBytesAfterCommit"`
	QuotaBytes            int64    `json:"quotaBytes"`
}

type backupSummaryResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	CardID      string `json:"cardId"`
	CardVersion string `json:"cardVersion"`
	RevisionID  string `json:"revisionId"`
	SizeBytes   int64  `json:"sizeBytes"`
	FileCount   int    `json:"fileCount"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type listResponse struct {
	Backups    []backupSummaryResponse `json:"backups"`
	UsageBytes int64                   `json:"usageBytes"`
	QuotaBytes int64                   `json:"quotaBytes"`
}

type manifestResponse struct {
	backupSummaryResponse
	Files []FileEntry `json:"files"`
}

type normalizedBackupInput struct {
	BackupID           string
	ExpectedRevisionID *string
	Force              bool
	Name               string
	CardID             string
	CardVersion        string
	Files              []FileEntry
	ManifestJSON       string
	SizeBytes          int64
}

func NewHandler(repo Repository, blobStore storage.BlobStore) *Handler {
	return &Handler{repo: repo, blobStore: blobStore}
}

func (h *Handler) HandleList(w http.ResponseWriter, r *http.Request) {
	account, ok := requireAccount(w, r)
	if !ok {
		return
	}
	cardID := strings.TrimSpace(r.URL.Query().Get("cardId"))
	items, err := h.repo.List(r.Context(), account.ID, cardID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to list cloud backups"})
		return
	}
	usage, err := h.repo.TotalUsage(r.Context(), account.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to read cloud backup usage"})
		return
	}
	response := listResponse{
		Backups:    make([]backupSummaryResponse, 0, len(items)),
		UsageBytes: usage,
		QuotaBytes: QuotaBytes,
	}
	for _, item := range items {
		response.Backups = append(response.Backups, toSummaryResponse(item))
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) HandlePrepare(w http.ResponseWriter, r *http.Request) {
	account, ok := requireAccount(w, r)
	if !ok {
		return
	}
	input, existing, ok := h.decodeAndValidateBackupRequest(w, r, account.ID, true)
	if !ok {
		return
	}
	missing := make([]string, 0)
	for _, file := range input.Files {
		blob, err := h.repo.GetBlob(r.Context(), account.ID, file.Hash)
		if errors.Is(err, ErrNotFound) {
			missing = append(missing, file.Hash)
			continue
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to inspect cloud backup blobs"})
			return
		}
		if blob.SizeBytes != file.Size {
			missing = append(missing, file.Hash)
		}
	}
	usage, err := h.projectedUsage(r.Context(), account.ID, existing, input.SizeBytes)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to calculate cloud backup usage"})
		return
	}
	writeJSON(w, http.StatusOK, prepareResponse{
		BackupID:              input.BackupID,
		MissingHashes:         uniqueStrings(missing),
		UsageBytesAfterCommit: usage,
		QuotaBytes:            QuotaBytes,
	})
}

func (h *Handler) HandleUploadBlob(w http.ResponseWriter, r *http.Request) {
	account, ok := requireAccount(w, r)
	if !ok {
		return
	}
	hash := strings.ToLower(strings.TrimSpace(r.PathValue("hash")))
	if !sha256Pattern.MatchString(hash) {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid blob hash"})
		return
	}
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, MaxBlobBodyBytes)
	content, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "failed to read blob"})
		return
	}
	actual := sha256Hex(content)
	if actual != hash {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "blob hash mismatch"})
		return
	}
	storageKey := blobKey(account.ID, hash)
	if existing, err := h.repo.GetBlob(r.Context(), account.ID, hash); err == nil && existing.SizeBytes == int64(len(content)) {
		w.WriteHeader(http.StatusNoContent)
		return
	} else if err != nil && !errors.Is(err, ErrNotFound) {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to inspect blob"})
		return
	}
	if err := h.blobStore.Put(r.Context(), storageKey, bytes.NewReader(content)); err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to store blob"})
		return
	}
	mediaType := strings.TrimSpace(r.Header.Get("Content-Type"))
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	if err := h.repo.PutBlob(r.Context(), BlobRecord{
		OwnerUserID: account.ID,
		Hash:        hash,
		SizeBytes:   int64(len(content)),
		MediaType:   mediaType,
		StorageKey:  storageKey,
		CreatedAt:   time.Now().UTC(),
	}); err != nil {
		_ = h.blobStore.Delete(r.Context(), storageKey)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to record blob"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) HandleCommit(w http.ResponseWriter, r *http.Request) {
	account, ok := requireAccount(w, r)
	if !ok {
		return
	}
	pathID := strings.TrimSpace(r.PathValue("id"))
	input, existing, ok := h.decodeAndValidateBackupRequest(w, r, account.ID, false)
	if !ok {
		return
	}
	if pathID == "" || pathID != input.BackupID {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "backup id mismatch"})
		return
	}
	for _, file := range input.Files {
		blob, err := h.repo.GetBlob(r.Context(), account.ID, file.Hash)
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "missing uploaded blob: " + file.Hash})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to inspect cloud backup blob"})
			return
		}
		if blob.SizeBytes != file.Size {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "blob size mismatch: " + file.Hash})
			return
		}
	}
	revisionID, err := user.NewID()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to create revision"})
		return
	}
	updated, err := h.repo.Upsert(r.Context(), UpsertInput{
		ID:           input.BackupID,
		OwnerUserID:  account.ID,
		Name:         input.Name,
		CardID:       input.CardID,
		CardVersion:  input.CardVersion,
		RevisionID:   revisionID,
		ManifestJSON: input.ManifestJSON,
		SizeBytes:    input.SizeBytes,
		FileCount:    len(input.Files),
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to commit cloud backup"})
		return
	}
	_ = h.gcOwnerBlobs(r.Context(), account.ID)
	_ = existing
	writeJSON(w, http.StatusOK, toManifestResponse(updated))
}

func (h *Handler) HandleManifest(w http.ResponseWriter, r *http.Request) {
	account, ok := requireAccount(w, r)
	if !ok {
		return
	}
	backup, ok := h.getOwnedBackup(w, r, account.ID)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, toManifestResponse(backup))
}

func (h *Handler) HandleDownloadBlob(w http.ResponseWriter, r *http.Request) {
	account, ok := requireAccount(w, r)
	if !ok {
		return
	}
	backup, ok := h.getOwnedBackup(w, r, account.ID)
	if !ok {
		return
	}
	hash := strings.ToLower(strings.TrimSpace(r.PathValue("hash")))
	if !sha256Pattern.MatchString(hash) {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid blob hash"})
		return
	}
	if !manifestReferencesHash(backup.ManifestJSON, hash) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "blob not referenced by backup"})
		return
	}
	blob, err := h.repo.GetBlob(r.Context(), account.ID, hash)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "blob not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to read blob record"})
		return
	}
	reader, err := h.blobStore.Open(r.Context(), blob.StorageKey)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "blob content not found"})
		return
	}
	defer reader.Close()
	w.Header().Set("Content-Type", blob.MediaType)
	w.Header().Set("Content-Length", fmt.Sprint(blob.SizeBytes))
	_, _ = io.Copy(w, reader)
}

func (h *Handler) HandleDelete(w http.ResponseWriter, r *http.Request) {
	account, ok := requireAccount(w, r)
	if !ok {
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "missing cloud backup id"})
		return
	}
	if err := h.repo.Delete(r.Context(), account.ID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "cloud backup not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to delete cloud backup"})
		return
	}
	_ = h.gcOwnerBlobs(r.Context(), account.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) decodeAndValidateBackupRequest(w http.ResponseWriter, r *http.Request, ownerUserID string, allowGeneratedID bool) (normalizedBackupInput, *Backup, bool) {
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, MaxJSONBodyBytes)
	var req backupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
		return normalizedBackupInput{}, nil, false
	}
	input, err := normalizeBackupRequest(req, allowGeneratedID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return normalizedBackupInput{}, nil, false
	}
	existing, err := h.repo.Get(r.Context(), ownerUserID, input.BackupID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to read cloud backup"})
		return normalizedBackupInput{}, nil, false
	}
	var existingPtr *Backup
	if err == nil {
		existingPtr = &existing
	}
	if existingPtr != nil && input.ExpectedRevisionID != nil && *input.ExpectedRevisionID != existingPtr.RevisionID && !input.Force {
		writeJSON(w, http.StatusConflict, errorBody{Error: "cloud backup changed on another device"})
		return normalizedBackupInput{}, nil, false
	}
	projected, err := h.projectedUsage(r.Context(), ownerUserID, existingPtr, input.SizeBytes)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to calculate cloud backup usage"})
		return normalizedBackupInput{}, nil, false
	}
	if projected > QuotaBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, errorBody{Error: "云备份空间不足"})
		return normalizedBackupInput{}, nil, false
	}
	return input, existingPtr, true
}

func normalizeBackupRequest(req backupRequest, allowGeneratedID bool) (normalizedBackupInput, error) {
	backupID := strings.TrimSpace(req.BackupID)
	if backupID == "" {
		if !allowGeneratedID {
			return normalizedBackupInput{}, errors.New("backupId is required")
		}
		id, err := user.NewID()
		if err != nil {
			return normalizedBackupInput{}, err
		}
		backupID = id
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return normalizedBackupInput{}, errors.New("name is required")
	}
	cardID := strings.TrimSpace(req.CardID)
	if cardID == "" {
		return normalizedBackupInput{}, errors.New("cardId is required")
	}
	cardVersion := strings.TrimSpace(req.CardVersion)
	if cardVersion == "" {
		return normalizedBackupInput{}, errors.New("cardVersion is required")
	}
	files := make([]FileEntry, 0, len(req.Files))
	seenPaths := map[string]bool{}
	var total int64
	for _, raw := range req.Files {
		entry, err := normalizeFileEntry(raw)
		if err != nil {
			return normalizedBackupInput{}, err
		}
		if seenPaths[entry.Path] {
			return normalizedBackupInput{}, fmt.Errorf("duplicate file path: %s", entry.Path)
		}
		seenPaths[entry.Path] = true
		total += entry.Size
		if total > QuotaBytes {
			return normalizedBackupInput{}, errors.New("backup is larger than quota")
		}
		files = append(files, entry)
	}
	manifestJSON, err := json.Marshal(files)
	if err != nil {
		return normalizedBackupInput{}, fmt.Errorf("marshal manifest: %w", err)
	}
	return normalizedBackupInput{
		BackupID:           backupID,
		ExpectedRevisionID: req.ExpectedRevisionID,
		Force:              req.Force,
		Name:               name,
		CardID:             cardID,
		CardVersion:        cardVersion,
		Files:              files,
		ManifestJSON:       string(manifestJSON),
		SizeBytes:          total,
	}, nil
}

func normalizeFileEntry(raw fileEntryRequest) (FileEntry, error) {
	path, err := normalizeBackupPath(raw.Path)
	if err != nil {
		return FileEntry{}, err
	}
	hash := strings.ToLower(strings.TrimSpace(raw.Hash))
	if !sha256Pattern.MatchString(hash) {
		return FileEntry{}, fmt.Errorf("invalid hash for %s", path)
	}
	if raw.Size < 0 {
		return FileEntry{}, fmt.Errorf("invalid size for %s", path)
	}
	mediaType := strings.TrimSpace(raw.MediaType)
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	kind := raw.Kind
	if kind != FileKindText && kind != FileKindBinary {
		return FileEntry{}, fmt.Errorf("invalid kind for %s", path)
	}
	return FileEntry{
		Path:      path,
		Hash:      hash,
		Size:      raw.Size,
		MediaType: mediaType,
		Kind:      kind,
		CreatedAt: raw.CreatedAt,
		UpdatedAt: raw.UpdatedAt,
	}, nil
}

func normalizeBackupPath(value string) (string, error) {
	raw := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if raw == "" || strings.HasPrefix(raw, "/") || strings.Contains(raw, "\x00") {
		return "", fmt.Errorf("invalid backup path: %s", value)
	}
	parts := make([]string, 0)
	for _, part := range strings.Split(raw, "/") {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			return "", fmt.Errorf("backup path cannot contain '..': %s", value)
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 {
		return "", errors.New("backup path is required")
	}
	path := strings.Join(parts, "/")
	if strings.HasPrefix(path, "save/") || path == "save" {
		return path, nil
	}
	if path == ".tsian/local" || strings.HasPrefix(path, ".tsian/local/") {
		return "", fmt.Errorf("backup path is local-only: %s", path)
	}
	if path == ".tsian" || strings.HasPrefix(path, ".tsian/") {
		return path, nil
	}
	return "", fmt.Errorf("backup path must be save-owned: %s", path)
}

func (h *Handler) projectedUsage(ctx context.Context, ownerUserID string, existing *Backup, nextSize int64) (int64, error) {
	usage, err := h.repo.TotalUsage(ctx, ownerUserID)
	if err != nil {
		return 0, err
	}
	if existing != nil {
		usage -= existing.SizeBytes
	}
	return usage + nextSize, nil
}

func (h *Handler) getOwnedBackup(w http.ResponseWriter, r *http.Request, ownerUserID string) (Backup, bool) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "missing cloud backup id"})
		return Backup{}, false
	}
	backup, err := h.repo.Get(r.Context(), ownerUserID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "cloud backup not found"})
			return Backup{}, false
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to read cloud backup"})
		return Backup{}, false
	}
	return backup, true
}

func (h *Handler) gcOwnerBlobs(ctx context.Context, ownerUserID string) error {
	backups, err := h.repo.List(ctx, ownerUserID, "")
	if err != nil {
		return err
	}
	referenced := map[string]bool{}
	for _, backup := range backups {
		var files []FileEntry
		if err := json.Unmarshal([]byte(backup.ManifestJSON), &files); err != nil {
			continue
		}
		for _, file := range files {
			referenced[file.Hash] = true
		}
	}
	blobs, err := h.repo.ListBlobs(ctx, ownerUserID)
	if err != nil {
		return err
	}
	for _, blob := range blobs {
		if referenced[blob.Hash] {
			continue
		}
		if err := h.repo.DeleteBlob(ctx, ownerUserID, blob.Hash); err != nil {
			return err
		}
		_ = h.blobStore.Delete(ctx, blob.StorageKey)
	}
	return nil
}

func toSummaryResponse(item Backup) backupSummaryResponse {
	return backupSummaryResponse{
		ID:          item.ID,
		Name:        item.Name,
		CardID:      item.CardID,
		CardVersion: item.CardVersion,
		RevisionID:  item.RevisionID,
		SizeBytes:   item.SizeBytes,
		FileCount:   item.FileCount,
		CreatedAt:   item.CreatedAt.Format(time.RFC3339),
		UpdatedAt:   item.UpdatedAt.Format(time.RFC3339),
	}
}

func toManifestResponse(item Backup) manifestResponse {
	var files []FileEntry
	_ = json.Unmarshal([]byte(item.ManifestJSON), &files)
	return manifestResponse{
		backupSummaryResponse: toSummaryResponse(item),
		Files:                 files,
	}
}

func manifestReferencesHash(manifestJSON string, hash string) bool {
	var files []FileEntry
	if err := json.Unmarshal([]byte(manifestJSON), &files); err != nil {
		return false
	}
	for _, file := range files {
		if file.Hash == hash {
			return true
		}
	}
	return false
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func blobKey(ownerUserID string, hash string) string {
	return "cloud-backups/" + ownerUserID + "/blobs/" + hash
}

func sha256Hex(bytes []byte) string {
	sum := sha256.Sum256(bytes)
	return hex.EncodeToString(sum[:])
}

func requireAccount(w http.ResponseWriter, r *http.Request) (*user.User, bool) {
	account, ok := user.FromContext(r.Context())
	if !ok || account == nil {
		writeJSON(w, http.StatusUnauthorized, errorBody{Error: "authentication required"})
		return nil, false
	}
	return account, true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
