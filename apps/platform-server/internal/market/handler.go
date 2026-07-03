package market

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"tsian/platform-server/internal/storage"
	"tsian/platform-server/internal/user"
)

const maxUploadSize = 50 << 20 // 50 MB

// packageManifestPayload mirrors GameCardPackageManifest — the top-level
// object stored at game-card.json inside a .tsian-card.zip. The actual
// GameCardManifest lives under its `manifest` field.
type packageManifestPayload struct {
	Schema    string                 `json:"schema"`
	Manifest  manifestPayload        `json:"manifest"`
}

// manifestPayload is the minimal subset of GameCardManifest needed for
// server-side upload validation. We do not import the contracts package
// (Go) — the frontend's importGameCardPackage does full validation on
// download-install; the server only guards against garbage uploads.
type manifestPayload struct {
	Schema   string `json:"schema"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Version  string `json:"version"`
	Summary  string `json:"summary"`
	Author   *authorPayload `json:"author,omitempty"`
	Cover    *coverPayload `json:"cover,omitempty"`
}

type authorPayload struct {
	Name string `json:"name"`
	URL  string `json:"url,omitempty"`
}

type coverPayload struct {
	URL          string `json:"url,omitempty"`
	WorkspacePath string `json:"workspacePath,omitempty"`
}

type packageResponse struct {
	ID            string                 `json:"id"`
	ResourceType  string                 `json:"resourceType"`
	CardID        string                 `json:"cardId"`
	CardAuthor    string                 `json:"cardAuthor"`
	CardVersion   string                 `json:"cardVersion"`
	Name          string                 `json:"name"`
	Summary       string                 `json:"summary"`
	CoverURL      *string                `json:"coverUrl"`
	Uploader      uploaderResponse       `json:"uploader"`
	DownloadCount int                    `json:"downloadCount"`
	CreatedAt     string                 `json:"createdAt"`
}

type uploaderResponse struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
}

type listResponse struct {
	Packages []packageResponse `json:"packages"`
}

type Handler struct {
	repo      Repository
	blobStore storage.BlobStore
}

func NewHandler(repo Repository, blobStore storage.BlobStore) *Handler {
	return &Handler{repo: repo, blobStore: blobStore}
}

func (h *Handler) HandleList(w http.ResponseWriter, r *http.Request) {
	filter := ListFilter{
		Query: strings.TrimSpace(r.URL.Query().Get("q")),
		Sort:  r.URL.Query().Get("sort"),
	}
	items, err := h.repo.List(r.Context(), filter)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to list packages"})
		return
	}
	resp := listResponse{Packages: make([]packageResponse, 0, len(items))}
	for _, item := range items {
		resp.Packages = append(resp.Packages, toPackageResponse(item))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) HandleGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "missing package id"})
		return
	}
	item, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "package not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to get package"})
		return
	}
	writeJSON(w, http.StatusOK, toPackageResponse(*item))
}

func (h *Handler) HandleUpload(w http.ResponseWriter, r *http.Request) {
	account, ok := user.FromContext(r.Context())
	if !ok || account == nil {
		writeJSON(w, http.StatusUnauthorized, errorBody{Error: "authentication required"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "failed to parse upload (max 50MB): " + err.Error()})
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "missing 'file' field"})
		return
	}
	defer file.Close()

	// Read the upload into memory for dual use (manifest validation + blob storage).
	// 50MB cap makes this safe.
	content, err := io.ReadAll(file)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "failed to read upload"})
		return
	}

	manifest, err := validatePackageZip(content)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}

	packageID, err := user.NewID()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to generate id"})
		return
	}

	blobKey := "market/" + packageID + ".zip"
	if err := h.blobStore.Put(r.Context(), blobKey, bytes.NewReader(content)); err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to store package"})
		return
	}

	// Extract cover image from the zip's cover/ directory and store it.
	// The frontend export places covers at cover/cover.<ext>.
	coverBlobKey := extractAndStoreCover(r.Context(), h.blobStore, content, packageID)

	// Title/summary form fields override manifest values if provided.
	name := strings.TrimSpace(r.FormValue("title"))
	if name == "" {
		name = manifest.Name
	}
	summary := strings.TrimSpace(r.FormValue("summary"))
	if summary == "" {
		summary = manifest.Summary
	}

	pkg := Package{
		ID:           packageID,
		ResourceType: ResourceGameCard,
		CardID:       manifest.ID,
		CardAuthor:   authorName(manifest),
		CardVersion:  manifest.Version,
		Name:         name,
		Summary:      summary,
		CoverBlobKey: coverBlobKey,
		UploaderID:   account.ID,
	}
	if err := h.repo.Create(r.Context(), pkg); err != nil {
		// Best-effort cleanup the blobs we just wrote.
		_ = h.blobStore.Delete(r.Context(), blobKey)
		if coverBlobKey != "" {
			_ = h.blobStore.Delete(r.Context(), coverBlobKey)
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to create package record"})
		return
	}

	created, err := h.repo.GetByID(r.Context(), packageID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to read created package"})
		return
	}
	writeJSON(w, http.StatusCreated, toPackageResponse(*created))
}

func (h *Handler) HandleDownload(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "missing package id"})
		return
	}
	pkg, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "package not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to get package"})
		return
	}

	blobKey := "market/" + pkg.ID + ".zip"
	reader, err := h.blobStore.Open(r.Context(), blobKey)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to open package file"})
		return
	}
	defer reader.Close()

	// Best-effort increment; don't block download on counter failure.
	_ = h.repo.IncrementDownloadCount(r.Context(), id)

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.zip"`, pkg.CardID))
	if _, err := io.Copy(w, reader); err != nil {
		// Client may have disconnected; nothing useful to do.
		return
	}
}

// HandleCover serves the cover image blob for a package. Returns 404 when
// the package has no cover or the blob is missing.
func (h *Handler) HandleCover(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "missing package id"})
		return
	}
	pkg, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "package not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to get package"})
		return
	}
	if pkg.CoverBlobKey == "" {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "no cover"})
		return
	}
	reader, err := h.blobStore.Open(r.Context(), pkg.CoverBlobKey)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "cover not found"})
		return
	}
	defer reader.Close()
	ext := filepath.Ext(pkg.CoverBlobKey)
	contentType := coverContentType(ext)
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	if _, err := io.Copy(w, reader); err != nil {
		return
	}
}

// extractAndStoreCover reads the first file under cover/ in the zip and
// stores it via blobStore. Returns the blob key, or "" if no cover was found.
// The frontend export places covers at cover/cover.<ext>.
func extractAndStoreCover(ctx context.Context, store storage.BlobStore, zipContent []byte, packageID string) string {
	zipReader, err := zip.NewReader(bytes.NewReader(zipContent), int64(len(zipContent)))
	if err != nil {
		return ""
	}
	for _, f := range zipReader.File {
		if !strings.HasPrefix(f.Name, "cover/") || f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return ""
		}
		coverBytes, err := io.ReadAll(rc)
		rc.Close()
		if err != nil || len(coverBytes) == 0 {
			return ""
		}
		// Preserve the original extension for Content-Type inference on download.
		ext := filepath.Ext(f.Name)
		coverKey := "market/" + packageID + "/cover" + ext
		if err := store.Put(ctx, coverKey, bytes.NewReader(coverBytes)); err != nil {
			return ""
		}
		return coverKey
	}
	return ""
}

// validatePackageZip reads the zip in memory and extracts + validates the
// game-card.json manifest. It does NOT fully decompress all files — the
// frontend's importGameCardPackage does complete validation on install.
func validatePackageZip(content []byte) (*manifestPayload, error) {
	zipReader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return nil, fmt.Errorf("invalid zip file: %w", err)
	}

	var manifestFile *zip.File
	for _, f := range zipReader.File {
		if f.Name == "game-card.json" {
			manifestFile = f
			break
		}
	}
	if manifestFile == nil {
		return nil, errors.New("missing game-card.json manifest in package")
	}

	rc, err := manifestFile.Open()
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	defer rc.Close()

	manifestBytes, err := io.ReadAll(rc)
	if err != nil {
		return nil, fmt.Errorf("read manifest content: %w", err)
	}

	// game-card.json stores a GameCardPackageManifest, not a bare
	// GameCardManifest. Validate the package wrapper then the inner card.
	var pkgManifest packageManifestPayload
	if err := json.Unmarshal(manifestBytes, &pkgManifest); err != nil {
		return nil, fmt.Errorf("invalid manifest JSON: %w", err)
	}
	if pkgManifest.Schema != "tsian.game-card.package.v1" {
		return nil, fmt.Errorf("unsupported package schema: %s", pkgManifest.Schema)
	}

	card := pkgManifest.Manifest
	if card.Schema != "tsian.game-card.v1" {
		return nil, fmt.Errorf("unsupported manifest schema: %s", card.Schema)
	}
	if card.ID == "" {
		return nil, errors.New("manifest missing id")
	}
	if card.Name == "" {
		return nil, errors.New("manifest missing name")
	}
	if card.Version == "" {
		return nil, errors.New("manifest missing version")
	}
	if card.Summary == "" {
		return nil, errors.New("manifest missing summary")
	}
	return &card, nil
}

func toPackageResponse(item PackageWithUploader) packageResponse {
	var coverURL *string
	if item.CoverBlobKey != "" {
		url := "/api/v1/market/packages/" + item.ID + "/cover"
		coverURL = &url
	}
	return packageResponse{
		ID:           item.ID,
		ResourceType: string(item.ResourceType),
		CardID:       item.CardID,
		CardAuthor:   item.CardAuthor,
		CardVersion:  item.CardVersion,
		Name:         item.Name,
		Summary:      item.Summary,
		CoverURL:     coverURL,
		Uploader: uploaderResponse{
			ID:          item.UploaderID,
			DisplayName: item.UploaderDisplayName,
			AvatarURL:   item.UploaderAvatarURL,
		},
		DownloadCount: item.DownloadCount,
		CreatedAt:     item.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func authorName(manifest *manifestPayload) string {
	if manifest.Author != nil && manifest.Author.Name != "" {
		return manifest.Author.Name
	}
	return ""
}

func coverContentType(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	default:
		return ""
	}
}

type errorBody struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
