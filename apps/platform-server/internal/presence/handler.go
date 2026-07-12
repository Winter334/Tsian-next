package presence

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"tsian/platform-server/internal/auth"
	"tsian/platform-server/internal/user"
)

type Handler struct {
	repo         Repository
	db           *sql.DB
	users        user.Repository
	cookieSecure bool
}

type summaryResponse struct {
	OnlineCount         int `json:"onlineCount"`
	ActiveWindowSeconds int `json:"activeWindowSeconds"`
}

type errorBody struct {
	Error string `json:"error"`
}

func NewHandler(repo Repository, db *sql.DB, users user.Repository, cookieSecure bool) *Handler {
	return &Handler{repo: repo, db: db, users: users, cookieSecure: cookieSecure}
}

func (h *Handler) HandleHeartbeat(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	sessionID, err := h.presenceSessionID(w, r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to create presence session"})
		return
	}
	userID := h.optionalUserID(r)
	if err := h.repo.Heartbeat(r.Context(), sessionID, userID, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to record heartbeat"})
		return
	}
	_ = h.repo.PruneBefore(r.Context(), now.Add(-RetentionWindow))
	h.writeSummary(w, r, now)
}

func (h *Handler) HandleSummary(w http.ResponseWriter, r *http.Request) {
	h.writeSummary(w, r, time.Now().UTC())
}

func (h *Handler) writeSummary(w http.ResponseWriter, r *http.Request, now time.Time) {
	count, err := h.repo.CountActive(r.Context(), now.Add(-ActiveWindow))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "failed to read presence summary"})
		return
	}
	writeJSON(w, http.StatusOK, summaryResponse{
		OnlineCount:         count,
		ActiveWindowSeconds: int(ActiveWindow.Seconds()),
	})
}

func (h *Handler) presenceSessionID(w http.ResponseWriter, r *http.Request) (string, error) {
	if cookie, err := r.Cookie(CookieName); err == nil && cookie.Value != "" {
		return cookie.Value, nil
	}
	token, err := auth.GenerateToken()
	if err != nil {
		return "", err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(CookieMaxAge.Seconds()),
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	return token, nil
}

func (h *Handler) optionalUserID(r *http.Request) *string {
	cookie, err := r.Cookie(auth.SessionCookieName)
	if err != nil || cookie.Value == "" {
		return nil
	}
	userID, err := auth.ValidateSession(h.db, cookie.Value)
	if err != nil {
		return nil
	}
	if _, err := h.users.FindByID(r.Context(), userID); err != nil {
		return nil
	}
	return &userID
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
