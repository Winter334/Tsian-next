package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"tsian/platform-server/internal/config"
	"tsian/platform-server/internal/user"
)

var (
	errDiscordRegistrationForbidden    = errors.New("discord registration forbidden")
	errDiscordRegistrationLookupFailed = errors.New("discord registration lookup failed")
)

type discordOAuthClient interface {
	AuthorizeURL(state string) string
	Exchange(ctx context.Context, code string) (string, error)
	FetchMe(ctx context.Context, accessToken string) (user.DiscordIdentity, error)
	RegistrationAllowed(ctx context.Context, accessToken string) (bool, error)
}

type Handler struct {
	cfg     config.Config
	db      *sql.DB
	users   user.Repository
	discord discordOAuthClient
}

type userResponse struct {
	ID            string   `json:"id"`
	Handle        string   `json:"handle"`
	DisplayName   string   `json:"displayName"`
	AvatarURL     *string  `json:"avatarUrl"`
	AuthProviders []string `json:"authProviders"`
}

func NewHandler(cfg config.Config, db *sql.DB, users user.Repository) *Handler {
	return &Handler{
		cfg:     cfg,
		db:      db,
		users:   users,
		discord: NewDiscordClient(cfg),
	}
}

func (h *Handler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if h.cfg.DiscordClientID == "" || h.cfg.DiscordClientSecret == "" {
		http.Error(w, "discord oauth is not configured", http.StatusServiceUnavailable)
		return
	}
	if h.cfg.DiscordRegistrationGateMisconfigured() {
		http.Error(w, "discord registration gate is misconfigured", http.StatusServiceUnavailable)
		return
	}

	state, err := GenerateToken()
	if err != nil {
		http.Error(w, "failed to generate oauth state", http.StatusInternalServerError)
		return
	}
	SetOAuthStateCookie(w, state, h.cfg.CookieSecure)
	http.Redirect(w, r, h.discord.AuthorizeURL(state), http.StatusFound)
}

func (h *Handler) HandleCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" || state == "" {
		http.Error(w, "missing oauth code or state", http.StatusBadRequest)
		return
	}
	if h.cfg.DiscordRegistrationGateMisconfigured() {
		http.Error(w, "discord registration gate is misconfigured", http.StatusServiceUnavailable)
		return
	}

	stateCookie, err := r.Cookie(oauthStateCookieName)
	if err != nil || stateCookie.Value == "" || stateCookie.Value != state {
		http.Error(w, "invalid oauth state", http.StatusBadRequest)
		return
	}
	ClearOAuthStateCookie(w, h.cfg.CookieSecure)

	accessToken, err := h.discord.Exchange(r.Context(), code)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	identity, err := h.discord.FetchMe(r.Context(), accessToken)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if err := h.authorizeDiscordRegistration(r.Context(), accessToken, identity); err != nil {
		if errors.Is(err, errDiscordRegistrationForbidden) {
			http.Error(w, "discord role is not allowed to register", http.StatusForbidden)
			return
		}
		if errors.Is(err, errDiscordRegistrationLookupFailed) {
			http.Error(w, "failed to look up user", http.StatusInternalServerError)
			return
		}
		http.Error(w, "failed to verify discord registration", http.StatusBadGateway)
		return
	}
	account, err := h.users.UpsertDiscord(r.Context(), identity)
	if err != nil {
		http.Error(w, "failed to save user", http.StatusInternalServerError)
		return
	}
	h.setSessionAndRedirect(w, r, account)
}

func (h *Handler) authorizeDiscordRegistration(ctx context.Context, accessToken string, identity user.DiscordIdentity) error {
	if !h.cfg.DiscordRegistrationGateEnabled() {
		return nil
	}

	_, err := h.users.FindByIdentity(ctx, user.ProviderDiscord, identity.DiscordID)
	if err == nil {
		return nil
	}
	if !errors.Is(err, user.ErrNotFound) {
		return fmt.Errorf("%w: %v", errDiscordRegistrationLookupFailed, err)
	}

	allowed, err := h.discord.RegistrationAllowed(ctx, accessToken)
	if err != nil {
		return err
	}
	if !allowed {
		return errDiscordRegistrationForbidden
	}
	return nil
}

func (h *Handler) HandleMockLogin(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.MockAuth {
		http.NotFound(w, r)
		return
	}
	avatar := "https://cdn.discordapp.com/embed/avatars/0.png"
	account, err := h.users.UpsertDiscord(r.Context(), user.DiscordIdentity{
		DiscordID: "mock-discord-user",
		Username:  "Mock Player",
		AvatarURL: &avatar,
	})
	if err != nil {
		http.Error(w, "failed to save mock user", http.StatusInternalServerError)
		return
	}
	h.setSessionAndRedirect(w, r, account)
}

func (h *Handler) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(SessionCookieName); err == nil && cookie.Value != "" {
		if err := DeleteSession(h.db, cookie.Value); err != nil {
			http.Error(w, "failed to delete session", http.StatusInternalServerError)
			return
		}
	}
	ClearSessionCookie(w, h.cfg.CookieSecure)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) HandleMe(w http.ResponseWriter, r *http.Request) {
	account, ok := user.FromContext(r.Context())
	if !ok || account == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, toUserResponse(account))
}

func (h *Handler) setSessionAndRedirect(w http.ResponseWriter, r *http.Request, account *user.User) {
	token, err := CreateSession(h.db, account.ID)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	SetSessionCookie(w, token, h.cfg.CookieSecure)
	http.Redirect(w, r, "/", http.StatusFound)
}

func toUserResponse(account *user.User) userResponse {
	providers := make([]string, 0, len(account.AuthProviders))
	for _, provider := range account.AuthProviders {
		providers = append(providers, string(provider))
	}
	return userResponse{
		ID:            account.ID,
		Handle:        account.Handle,
		DisplayName:   account.DisplayName,
		AvatarURL:     account.AvatarURL,
		AuthProviders: providers,
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
