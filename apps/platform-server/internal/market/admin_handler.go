package market

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"tsian/platform-server/internal/user"
)

type adminPackageResponse struct {
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
	HiddenAt        *string          `json:"hiddenAt"`
	HiddenBy        *string          `json:"hiddenBy"`
	CreatedAt       string           `json:"createdAt"`
	UpdatedAt       string           `json:"updatedAt"`
}

type adminListResponse struct {
	Packages   []adminPackageResponse `json:"packages"`
	NextCursor *string                `json:"nextCursor"`
}

type adminMetadataUpdateRequest struct {
	Name    string   `json:"name"`
	Summary string   `json:"summary"`
	Tags    []string `json:"tags"`
}

func (h *Handler) HandleAdminList(w http.ResponseWriter, r *http.Request) {
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
	visibility, err := parseAdminVisibility(r.URL.Query().Get("visibility"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}

	result, err := h.repo.List(r.Context(), ListFilter{
		Query:         strings.TrimSpace(r.URL.Query().Get("q")),
		Sort:          r.URL.Query().Get("sort"),
		Limit:         limit,
		Cursor:        strings.TrimSpace(r.URL.Query().Get("cursor")),
		ResourceType:  resourceType,
		Tag:           tag,
		UploaderQuery: strings.TrimSpace(r.URL.Query().Get("uploader")),
		Visibility:    visibility,
	})
	if err != nil {
		if errors.Is(err, ErrInvalidCursor) {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid cursor"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to list packages"})
		return
	}

	resp := adminListResponse{Packages: make([]adminPackageResponse, 0, len(result.Items))}
	if result.NextCursor != "" {
		resp.NextCursor = &result.NextCursor
	}
	for _, item := range result.Items {
		resp.Packages = append(resp.Packages, toAdminPackageResponse(item))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) HandleAdminGet(w http.ResponseWriter, r *http.Request) {
	item, ok := h.adminPackageByID(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, toAdminPackageResponse(*item))
}

func (h *Handler) HandleAdminUpdate(w http.ResponseWriter, r *http.Request) {
	item, ok := h.adminPackageByID(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()

	var req adminMetadataUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
		return
	}
	metadata, err := normalizeAdminMetadata(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	if err := h.repo.Update(r.Context(), item.ID, metadata.ToPackageUpdate(*item)); err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "package not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to update package"})
		return
	}
	updated, err := h.repo.GetByIDForAdmin(r.Context(), item.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to read updated package"})
		return
	}
	writeJSON(w, http.StatusOK, toAdminPackageResponse(*updated))
}

func (h *Handler) HandleAdminHide(w http.ResponseWriter, r *http.Request) {
	item, ok := h.adminPackageByID(w, r)
	if !ok {
		return
	}
	account, ok := user.FromContext(r.Context())
	if !ok || account == nil {
		writeJSON(w, http.StatusUnauthorized, errorBody{Error: "authentication required"})
		return
	}
	if err := h.repo.SetHidden(r.Context(), item.ID, account.ID); err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "package not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to hide package"})
		return
	}
	updated, err := h.repo.GetByIDForAdmin(r.Context(), item.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to read updated package"})
		return
	}
	writeJSON(w, http.StatusOK, toAdminPackageResponse(*updated))
}

func (h *Handler) HandleAdminUnhide(w http.ResponseWriter, r *http.Request) {
	item, ok := h.adminPackageByID(w, r)
	if !ok {
		return
	}
	if err := h.repo.ClearHidden(r.Context(), item.ID); err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "package not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to unhide package"})
		return
	}
	updated, err := h.repo.GetByIDForAdmin(r.Context(), item.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to read updated package"})
		return
	}
	writeJSON(w, http.StatusOK, toAdminPackageResponse(*updated))
}

func (h *Handler) HandleAdminDelete(w http.ResponseWriter, r *http.Request) {
	item, ok := h.adminPackageByID(w, r)
	if !ok {
		return
	}
	if err := h.repo.Delete(r.Context(), item.ID); err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "package not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to delete package"})
		return
	}
	h.cleanupPackageBlobs(r.Context(), storedPackageBlobs{
		ZipKey:            packageBlobKey(item.ID),
		CoverBlobKey:      item.CoverBlobKey,
		CoverThumbBlobKey: item.CoverThumbBlobKey,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) adminPackageByID(w http.ResponseWriter, r *http.Request) (*PackageWithUploader, bool) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "missing package id"})
		return nil, false
	}
	item, err := h.repo.GetByIDForAdmin(r.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "package not found"})
			return nil, false
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to get package"})
		return nil, false
	}
	return item, true
}

func parseAdminVisibility(value string) (Visibility, error) {
	switch strings.TrimSpace(value) {
	case "", string(VisibilityAll):
		return VisibilityAll, nil
	case string(VisibilityVisible):
		return VisibilityVisible, nil
	case string(VisibilityHidden):
		return VisibilityHidden, nil
	default:
		return "", errors.New("unsupported visibility")
	}
}

func normalizeAdminMetadata(req adminMetadataUpdateRequest) (MetadataUpdate, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return MetadataUpdate{}, errors.New("name is required")
	}
	summary := strings.TrimSpace(req.Summary)
	if summary == "" {
		return MetadataUpdate{}, errors.New("summary is required")
	}
	tags, err := normalizeTagValues(req.Tags)
	if err != nil {
		return MetadataUpdate{}, err
	}
	return MetadataUpdate{Name: name, Summary: summary, Tags: tags}, nil
}

func toAdminPackageResponse(item PackageWithUploader) adminPackageResponse {
	base := toPackageResponse(item)
	return adminPackageResponse{
		ID:              base.ID,
		ResourceType:    base.ResourceType,
		ResourceID:      base.ResourceID,
		ResourceAuthor:  base.ResourceAuthor,
		ResourceVersion: base.ResourceVersion,
		Name:            base.Name,
		Summary:         base.Summary,
		Tags:            base.Tags,
		CoverURL:        base.CoverURL,
		CoverThumbURL:   base.CoverThumbURL,
		Uploader:        base.Uploader,
		DownloadCount:   base.DownloadCount,
		HiddenAt:        formatOptionalTime(item.HiddenAt),
		HiddenBy:        item.HiddenBy,
		CreatedAt:       base.CreatedAt,
		UpdatedAt:       base.UpdatedAt,
	}
}
