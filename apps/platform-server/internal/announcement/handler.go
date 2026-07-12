package announcement

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

type Handler struct {
	repo Repository
}

type announcementResponse struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type listResponse struct {
	Announcements []announcementResponse `json:"announcements"`
}

type inputRequest struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type errorBody struct {
	Error string `json:"error"`
}

func NewHandler(repo Repository) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) HandleList(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	items, err := h.repo.List(r.Context(), limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to list announcements"})
		return
	}
	resp := listResponse{Announcements: make([]announcementResponse, 0, len(items))}
	for _, item := range items {
		resp.Announcements = append(resp.Announcements, toResponse(item))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeInput(w, r)
	if !ok {
		return
	}
	created, err := h.repo.Create(r.Context(), input)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to create announcement"})
		return
	}
	writeJSON(w, http.StatusCreated, toResponse(created))
}

func (h *Handler) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "missing announcement id"})
		return
	}
	input, ok := decodeInput(w, r)
	if !ok {
		return
	}
	updated, err := h.repo.Update(r.Context(), id, input)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "announcement not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to update announcement"})
		return
	}
	writeJSON(w, http.StatusOK, toResponse(updated))
}

func (h *Handler) HandleDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "missing announcement id"})
		return
	}
	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "announcement not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to delete announcement"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decodeInput(w http.ResponseWriter, r *http.Request) (Input, bool) {
	defer r.Body.Close()
	var req inputRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
		return Input{}, false
	}
	input, err := NormalizeInput(Input{Title: req.Title, Body: req.Body})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return Input{}, false
	}
	return input, true
}

func parseLimit(value string) (int, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 50, nil
	}
	limit, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, errors.New("invalid limit")
	}
	if limit <= 0 {
		return 50, nil
	}
	if limit > 100 {
		return 100, nil
	}
	return limit, nil
}

func toResponse(item Announcement) announcementResponse {
	return announcementResponse{
		ID:        item.ID,
		Title:     item.Title,
		Body:      item.Body,
		CreatedAt: item.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: item.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
