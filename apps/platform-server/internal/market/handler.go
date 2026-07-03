package market

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"tsian/platform-server/internal/storage"
	"tsian/platform-server/internal/user"
)

const maxUploadSize = 50 << 20 // 50 MB

const resourcePackageSchema = "tsian.resource.package.v1"

// packageManifestPayload mirrors GameCardPackageManifest — the top-level
// object stored at game-card.json inside a .tsian-card.zip. The actual
// GameCardManifest lives under its `manifest` field.
type packageManifestPayload struct {
	Schema   string          `json:"schema"`
	Manifest manifestPayload `json:"manifest"`
}

// manifestPayload is the minimal subset of GameCardManifest needed for
// server-side upload validation. We do not import the contracts package
// (Go) — the frontend's importGameCardPackage does full validation on
// download-install; the server only guards against garbage uploads.
type manifestPayload struct {
	Schema  string         `json:"schema"`
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	Version string         `json:"version"`
	Summary string         `json:"summary"`
	Author  *authorPayload `json:"author,omitempty"`
	Cover   *coverPayload  `json:"cover,omitempty"`
}

type resourcePackageManifest struct {
	Schema       string                     `json:"schema"`
	ResourceType string                     `json:"resourceType"`
	ResourceID   string                     `json:"resourceId"`
	Name         string                     `json:"name"`
	Summary      string                     `json:"summary"`
	Author       string                     `json:"author"`
	Version      string                     `json:"version"`
	Files        []resourcePackageFileEntry `json:"files"`
}

type resourcePackageFileEntry struct {
	Path      string `json:"path"`
	MediaType string `json:"mediaType,omitempty"`
}

type uploadManifest struct {
	ResourceType    ResourceType
	ResourceID      string
	ResourceAuthor  string
	ResourceVersion string
	Name            string
	Summary         string
}

type authorPayload struct {
	Name string `json:"name"`
	URL  string `json:"url,omitempty"`
}

type coverPayload struct {
	URL           string `json:"url,omitempty"`
	WorkspacePath string `json:"workspacePath,omitempty"`
}

type packageResponse struct {
	ID              string           `json:"id"`
	ResourceType    string           `json:"resourceType"`
	ResourceID      string           `json:"resourceId"`
	ResourceAuthor  string           `json:"resourceAuthor"`
	ResourceVersion string           `json:"resourceVersion"`
	Name            string           `json:"name"`
	Summary         string           `json:"summary"`
	Tags            []string         `json:"tags"`
	CoverURL        *string          `json:"coverUrl"`
	CoverThumbURL   *string          `json:"coverThumbUrl"`
	Uploader        uploaderResponse `json:"uploader"`
	DownloadCount   int              `json:"downloadCount"`
	CreatedAt       string           `json:"createdAt"`
}

type uploaderResponse struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
}

type listResponse struct {
	Packages   []packageResponse `json:"packages"`
	NextCursor *string           `json:"nextCursor"`
}

type countsResponse struct {
	Counts map[string]int `json:"counts"`
}

type Handler struct {
	repo      Repository
	blobStore storage.BlobStore
}

func NewHandler(repo Repository, blobStore storage.BlobStore) *Handler {
	return &Handler{repo: repo, blobStore: blobStore}
}

func (h *Handler) HandleList(w http.ResponseWriter, r *http.Request) {
	resourceType, err := parseOptionalResourceType(r.URL.Query().Get("resourceType"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	tag, err := normalizeTagQuery(r.URL.Query().Get("tag"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	limit, err := parseListLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	filter := ListFilter{
		Query:        strings.TrimSpace(r.URL.Query().Get("q")),
		Sort:         r.URL.Query().Get("sort"),
		Limit:        limit,
		Cursor:       strings.TrimSpace(r.URL.Query().Get("cursor")),
		ResourceType: resourceType,
		Tag:          tag,
	}
	result, err := h.repo.List(r.Context(), filter)
	if err != nil {
		if errors.Is(err, ErrInvalidCursor) {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid cursor"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to list packages"})
		return
	}
	resp := listResponse{Packages: make([]packageResponse, 0, len(result.Items))}
	if result.NextCursor != "" {
		resp.NextCursor = &result.NextCursor
	}
	for _, item := range result.Items {
		resp.Packages = append(resp.Packages, toPackageResponse(item))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) HandleCounts(w http.ResponseWriter, r *http.Request) {
	counts, err := h.repo.Counts(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to count packages"})
		return
	}
	writeJSON(w, http.StatusOK, countsResponse{Counts: map[string]int{
		string(ResourceGameCard): counts[ResourceGameCard],
		string(ResourceAgent):    counts[ResourceAgent],
		string(ResourceSkill):    counts[ResourceSkill],
	}})
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

	resourceType, err := parseUploadResourceType(r.FormValue("resourceType"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	tags, err := normalizeTags(r.FormValue("tags"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}

	// Read the upload into memory for dual use (manifest validation + blob storage).
	// 50MB cap makes this safe.
	content, err := io.ReadAll(file)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "failed to read upload"})
		return
	}

	manifest, err := validateUploadZip(content, resourceType)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}

	packageID, err := user.NewID()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to generate id"})
		return
	}

	processed := processedCoverPackage{Content: content}
	if resourceType == ResourceGameCard {
		processed, err = processGameCardPackageCover(content)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "failed to process package cover"})
			return
		}
	}

	blobKey := "market/" + packageID + ".zip"
	if err := h.blobStore.Put(r.Context(), blobKey, bytes.NewReader(processed.Content)); err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to store package"})
		return
	}

	coverBlobKey := ""
	coverThumbBlobKey := ""
	if len(processed.Display) > 0 {
		coverBlobKey = "market/" + packageID + "/cover.webp"
		if err := h.blobStore.Put(r.Context(), coverBlobKey, bytes.NewReader(processed.Display)); err != nil {
			_ = h.blobStore.Delete(r.Context(), blobKey)
			writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to store cover"})
			return
		}
	}
	if len(processed.Thumb) > 0 {
		coverThumbBlobKey = "market/" + packageID + "/cover-thumb.webp"
		if err := h.blobStore.Put(r.Context(), coverThumbBlobKey, bytes.NewReader(processed.Thumb)); err != nil {
			_ = h.blobStore.Delete(r.Context(), blobKey)
			if coverBlobKey != "" {
				_ = h.blobStore.Delete(r.Context(), coverBlobKey)
			}
			writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to store cover thumbnail"})
			return
		}
	}

	// Title/summary form fields override manifest values if provided.
	name := strings.TrimSpace(r.FormValue("title"))
	if name == "" {
		name = manifest.Name
	}
	summary := strings.TrimSpace(r.FormValue("summary"))
	if summary == "" {
		summary = manifest.Summary
	}
	resourceAuthor := strings.TrimSpace(r.FormValue("author"))
	if resourceAuthor == "" {
		resourceAuthor = manifest.ResourceAuthor
	}
	resourceVersion := strings.TrimSpace(r.FormValue("version"))
	if resourceVersion == "" {
		resourceVersion = manifest.ResourceVersion
	}

	pkg := Package{
		ID:                packageID,
		ResourceType:      resourceType,
		ResourceID:        manifest.ResourceID,
		ResourceAuthor:    resourceAuthor,
		ResourceVersion:   resourceVersion,
		Name:              name,
		Summary:           summary,
		Tags:              tags,
		CoverBlobKey:      coverBlobKey,
		CoverThumbBlobKey: coverThumbBlobKey,
		UploaderID:        account.ID,
	}
	if err := h.repo.Create(r.Context(), pkg); err != nil {
		// Best-effort cleanup the blobs we just wrote.
		_ = h.blobStore.Delete(r.Context(), blobKey)
		if coverBlobKey != "" {
			_ = h.blobStore.Delete(r.Context(), coverBlobKey)
		}
		if coverThumbBlobKey != "" {
			_ = h.blobStore.Delete(r.Context(), coverThumbBlobKey)
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
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, downloadFileName(*pkg)))
	if _, err := io.Copy(w, reader); err != nil {
		// Client may have disconnected; nothing useful to do.
		return
	}
}

// HandleCover serves the display cover image blob for a package. Returns 404
// when the package has no cover or the blob is missing.
func (h *Handler) HandleCover(w http.ResponseWriter, r *http.Request) {
	h.serveCoverVariant(w, r, func(pkg PackageWithUploader) string {
		return pkg.CoverBlobKey
	})
}

func (h *Handler) HandleCoverThumb(w http.ResponseWriter, r *http.Request) {
	h.serveCoverVariant(w, r, func(pkg PackageWithUploader) string {
		return pkg.CoverThumbBlobKey
	})
}

func (h *Handler) serveCoverVariant(w http.ResponseWriter, r *http.Request, keyFor func(PackageWithUploader) string) {
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
	blobKey := keyFor(*pkg)
	if blobKey == "" {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "no cover"})
		return
	}
	reader, err := h.blobStore.Open(r.Context(), blobKey)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "cover not found"})
		return
	}
	defer reader.Close()
	w.Header().Set("Content-Type", coverContentType(blobKey))
	w.Header().Set("Cache-Control", "public, max-age=3600")
	if _, err := io.Copy(w, reader); err != nil {
		return
	}
}

func validateUploadZip(content []byte, resourceType ResourceType) (*uploadManifest, error) {
	switch resourceType {
	case ResourceGameCard:
		manifest, err := validatePackageZip(content)
		if err != nil {
			return nil, err
		}
		return &uploadManifest{
			ResourceType:    ResourceGameCard,
			ResourceID:      manifest.ID,
			ResourceAuthor:  authorName(manifest),
			ResourceVersion: manifest.Version,
			Name:            manifest.Name,
			Summary:         manifest.Summary,
		}, nil
	case ResourceAgent, ResourceSkill:
		manifest, err := validateResourcePackageZip(content, resourceType)
		if err != nil {
			return nil, err
		}
		return &uploadManifest{
			ResourceType:    resourceType,
			ResourceID:      manifest.ResourceID,
			ResourceAuthor:  manifest.Author,
			ResourceVersion: manifest.Version,
			Name:            manifest.Name,
			Summary:         manifest.Summary,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported resource type: %s", resourceType)
	}
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

func validateResourcePackageZip(content []byte, expectedType ResourceType) (*resourcePackageManifest, error) {
	zipReader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return nil, fmt.Errorf("invalid zip file: %w", err)
	}

	filesByPath := make(map[string]*zip.File)
	var manifestFile *zip.File
	for _, f := range zipReader.File {
		normalizedPath, err := normalizeResourcePackagePath(f.Name)
		if err != nil {
			return nil, err
		}
		if f.FileInfo().IsDir() {
			continue
		}
		if normalizedPath == "resource-package.json" {
			manifestFile = f
			continue
		}
		filesByPath[normalizedPath] = f
	}
	if manifestFile == nil {
		return nil, errors.New("missing resource-package.json manifest in package")
	}

	manifestBytes, err := readZipFile(manifestFile)
	if err != nil {
		return nil, fmt.Errorf("read resource manifest: %w", err)
	}
	var manifest resourcePackageManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return nil, fmt.Errorf("invalid resource manifest JSON: %w", err)
	}
	if manifest.Schema != resourcePackageSchema {
		return nil, fmt.Errorf("unsupported resource package schema: %s", manifest.Schema)
	}
	if ResourceType(manifest.ResourceType) != expectedType {
		return nil, fmt.Errorf("resource package type %q does not match upload type %q", manifest.ResourceType, expectedType)
	}
	resourceID, err := normalizeResourcePackageID(manifest.ResourceID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(manifest.Name) == "" {
		return nil, errors.New("resource manifest missing name")
	}
	if strings.TrimSpace(manifest.Version) == "" {
		return nil, errors.New("resource manifest missing version")
	}
	if strings.TrimSpace(manifest.Summary) == "" {
		return nil, errors.New("resource manifest missing summary")
	}
	if len(manifest.Files) == 0 {
		return nil, errors.New("resource manifest must list files")
	}

	listedPaths := make(map[string]bool, len(manifest.Files))
	for _, entry := range manifest.Files {
		path, err := normalizeResourcePackagePath(entry.Path)
		if err != nil {
			return nil, err
		}
		if path == "resource-package.json" {
			return nil, errors.New("resource-package.json must not be listed as a resource file")
		}
		listedPaths[path] = true
		file := filesByPath[path]
		if file == nil {
			return nil, fmt.Errorf("resource manifest lists missing file: %s", path)
		}
		data, err := readZipFile(file)
		if err != nil {
			return nil, fmt.Errorf("read resource file %s: %w", path, err)
		}
		if !utf8.Valid(data) {
			return nil, fmt.Errorf("resource file %s is not valid UTF-8 text", path)
		}
	}
	for path := range filesByPath {
		if !listedPaths[path] {
			return nil, fmt.Errorf("resource package contains file not listed in manifest: %s", path)
		}
	}

	switch expectedType {
	case ResourceAgent:
		if !listedPaths["agent.json"] {
			return nil, errors.New("agent package missing agent.json")
		}
		if !listedPaths["AGENT.md"] {
			return nil, errors.New("agent package missing AGENT.md")
		}
	case ResourceSkill:
		if !listedPaths["SKILL.md"] {
			return nil, errors.New("skill package missing SKILL.md")
		}
	}

	manifest.ResourceID = resourceID
	manifest.Name = strings.TrimSpace(manifest.Name)
	manifest.Summary = strings.TrimSpace(manifest.Summary)
	manifest.Author = strings.TrimSpace(manifest.Author)
	manifest.Version = strings.TrimSpace(manifest.Version)
	return &manifest, nil
}

func readZipFile(file *zip.File) ([]byte, error) {
	rc, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func normalizeResourcePackagePath(value string) (string, error) {
	raw := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if raw == "" {
		return "", errors.New("resource package path is required")
	}
	if strings.HasPrefix(raw, "/") || strings.Contains(raw, "\x00") {
		return "", fmt.Errorf("unsafe resource package path: %s", raw)
	}
	parts := make([]string, 0)
	for _, part := range strings.Split(raw, "/") {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			return "", fmt.Errorf("resource package path cannot contain '..': %s", raw)
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 {
		return "", errors.New("resource package path is required")
	}
	return strings.Join(parts, "/"), nil
}

func normalizeResourcePackageID(value string) (string, error) {
	id, err := normalizeResourcePackagePath(value)
	if err != nil {
		return "", fmt.Errorf("invalid resourceId: %w", err)
	}
	if strings.Contains(id, "/") {
		return "", fmt.Errorf("invalid resourceId %q: '/' is not allowed", value)
	}
	return id, nil
}

func parseUploadResourceType(value string) (ResourceType, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ResourceGameCard, nil
	}
	return parseResourceType(trimmed)
}

func parseOptionalResourceType(value string) (ResourceType, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	return parseResourceType(trimmed)
}

func parseListLimit(value string) (int, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 24, nil
	}
	limit, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, fmt.Errorf("invalid limit: %s", value)
	}
	if limit <= 0 {
		return 24, nil
	}
	if limit > 100 {
		return 100, nil
	}
	return limit, nil
}

func parseResourceType(value string) (ResourceType, error) {
	switch ResourceType(value) {
	case ResourceGameCard, ResourceAgent, ResourceSkill:
		return ResourceType(value), nil
	default:
		return "", fmt.Errorf("unsupported resourceType: %s", value)
	}
}

func normalizeTags(value string) ([]string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return []string{}, nil
	}
	var values []string
	if strings.HasPrefix(trimmed, "[") {
		if err := json.Unmarshal([]byte(trimmed), &values); err != nil {
			return nil, fmt.Errorf("invalid tags JSON: %w", err)
		}
	} else {
		values = strings.Split(trimmed, ",")
	}
	return normalizeTagValues(values)
}

func normalizeTagQuery(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	tags, err := normalizeTagValues([]string{trimmed})
	if err != nil {
		return "", err
	}
	return tags[0], nil
}

func normalizeTagValues(values []string) ([]string, error) {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		tag := strings.ToLower(strings.TrimSpace(value))
		if tag == "" {
			continue
		}
		if err := validateTag(tag); err != nil {
			return nil, err
		}
		if seen[tag] {
			continue
		}
		seen[tag] = true
		result = append(result, tag)
		if len(result) > 10 {
			return nil, errors.New("tags can contain at most 10 items")
		}
	}
	return result, nil
}

func validateTag(tag string) error {
	length := 0
	for _, r := range tag {
		length++
		if r == '-' || r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r) {
			continue
		}
		return fmt.Errorf("invalid tag %q: only letters, numbers, '-' and '_' are allowed", tag)
	}
	if length == 0 || length > 32 {
		return fmt.Errorf("invalid tag %q: length must be 1-32 characters", tag)
	}
	return nil
}

func toPackageResponse(item PackageWithUploader) packageResponse {
	var coverURL *string
	if item.CoverBlobKey != "" {
		url := "/api/v1/market/packages/" + item.ID + "/cover"
		coverURL = &url
	}
	var coverThumbURL *string
	if item.CoverThumbBlobKey != "" {
		url := "/api/v1/market/packages/" + item.ID + "/cover-thumb"
		coverThumbURL = &url
	}
	tags := item.Tags
	if tags == nil {
		tags = []string{}
	}
	return packageResponse{
		ID:              item.ID,
		ResourceType:    string(item.ResourceType),
		ResourceID:      item.ResourceID,
		ResourceAuthor:  item.ResourceAuthor,
		ResourceVersion: item.ResourceVersion,
		Name:            item.Name,
		Summary:         item.Summary,
		Tags:            tags,
		CoverURL:        coverURL,
		CoverThumbURL:   coverThumbURL,
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

func downloadFileName(pkg PackageWithUploader) string {
	id := sanitizeDownloadName(pkg.ResourceID)
	if id == "" {
		id = pkg.ID
	}
	switch pkg.ResourceType {
	case ResourceAgent:
		return id + ".tsian-agent.zip"
	case ResourceSkill:
		return id + ".tsian-skill.zip"
	default:
		return id + ".tsian-card.zip"
	}
}

func sanitizeDownloadName(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "\\", "-")
	value = strings.ReplaceAll(value, "/", "-")
	value = strings.ReplaceAll(value, `"`, "")
	return value
}

func coverContentType(key string) string {
	if strings.HasSuffix(strings.ToLower(key), ".webp") {
		return "image/webp"
	}
	return "application/octet-stream"
}

type errorBody struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
