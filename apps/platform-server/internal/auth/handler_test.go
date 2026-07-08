package auth

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	"tsian/platform-server/internal/config"
	"tsian/platform-server/internal/storage"
	"tsian/platform-server/internal/user"
)

func TestDiscordAuthorizeURLScopes(t *testing.T) {
	base := config.Config{
		BaseURL:         "http://example.test",
		DiscordClientID: "client-id",
	}

	assertScope := func(t *testing.T, cfg config.Config, expected string) {
		t.Helper()
		authorizeURL := NewDiscordClient(cfg).AuthorizeURL("state-token")
		parsed, err := url.Parse(authorizeURL)
		if err != nil {
			t.Fatalf("parse authorize url: %v", err)
		}
		if scope := parsed.Query().Get("scope"); scope != expected {
			t.Fatalf("scope = %q, want %q", scope, expected)
		}
	}

	assertScope(t, base, "identify")

	withGate := base
	withGate.DiscordRegistrationGuildID = "guild-id"
	withGate.DiscordRegistrationRoleIDs = []string{"role-id"}
	assertScope(t, withGate, "identify guilds.members.read")
}

func TestDiscordRegistrationCallbackCreatesNewUserWithAllowedRole(t *testing.T) {
	cfg := authTestConfig()
	cfg.DiscordRegistrationGuildID = "guild-id"
	cfg.DiscordRegistrationRoleIDs = []string{"role-id"}
	fake := &fakeDiscordClient{
		accessToken:         "access-token",
		identity:            user.DiscordIdentity{DiscordID: "discord-new", Username: "Eligible Player"},
		registrationAllowed: true,
	}
	handler, db, users := newAuthTestHandler(t, cfg, fake)

	res := runCallback(t, handler, "oauth-state")
	if res.StatusCode != http.StatusFound {
		t.Fatalf("callback status = %d, want %d", res.StatusCode, http.StatusFound)
	}
	if fake.registrationChecks != 1 {
		t.Fatalf("registration checks = %d, want 1", fake.registrationChecks)
	}

	sessionCookie := requireCookie(t, res.Cookies(), SessionCookieName)
	if _, err := ValidateSession(db, sessionCookie.Value); err != nil {
		t.Fatalf("validate session: %v", err)
	}
	account, err := users.FindByIdentity(context.Background(), user.ProviderDiscord, "discord-new")
	if err != nil {
		t.Fatalf("find created discord identity: %v", err)
	}
	if account.DisplayName != "Eligible Player" {
		t.Fatalf("display name = %q, want %q", account.DisplayName, "Eligible Player")
	}
}

func TestDiscordRegistrationCallbackRejectsNewUserWithoutAllowedRole(t *testing.T) {
	cfg := authTestConfig()
	cfg.DiscordRegistrationGuildID = "guild-id"
	cfg.DiscordRegistrationRoleIDs = []string{"role-id"}
	fake := &fakeDiscordClient{
		accessToken:         "access-token",
		identity:            user.DiscordIdentity{DiscordID: "discord-denied", Username: "Denied Player"},
		registrationAllowed: false,
	}
	handler, _, users := newAuthTestHandler(t, cfg, fake)

	res := runCallback(t, handler, "oauth-state")
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("callback status = %d, want %d", res.StatusCode, http.StatusForbidden)
	}
	if fake.registrationChecks != 1 {
		t.Fatalf("registration checks = %d, want 1", fake.registrationChecks)
	}
	if cookie := findCookie(res.Cookies(), SessionCookieName); cookie != nil {
		t.Fatalf("session cookie was set for rejected registration")
	}
	_, err := users.FindByIdentity(context.Background(), user.ProviderDiscord, "discord-denied")
	if !errors.Is(err, user.ErrNotFound) {
		t.Fatalf("find rejected discord identity error = %v, want %v", err, user.ErrNotFound)
	}
}

func TestDiscordRegistrationCallbackSkipsGateForExistingIdentity(t *testing.T) {
	cfg := authTestConfig()
	cfg.DiscordRegistrationGuildID = "guild-id"
	cfg.DiscordRegistrationRoleIDs = []string{"role-id"}
	fake := &fakeDiscordClient{
		accessToken:         "access-token",
		identity:            user.DiscordIdentity{DiscordID: "discord-existing", Username: "Renamed Player"},
		registrationAllowed: false,
	}
	handler, db, users := newAuthTestHandler(t, cfg, fake)
	if _, err := users.UpsertDiscord(context.Background(), user.DiscordIdentity{DiscordID: "discord-existing", Username: "Original Player"}); err != nil {
		t.Fatalf("seed existing discord identity: %v", err)
	}

	res := runCallback(t, handler, "oauth-state")
	if res.StatusCode != http.StatusFound {
		t.Fatalf("callback status = %d, want %d", res.StatusCode, http.StatusFound)
	}
	if fake.registrationChecks != 0 {
		t.Fatalf("registration checks = %d, want 0", fake.registrationChecks)
	}
	sessionCookie := requireCookie(t, res.Cookies(), SessionCookieName)
	if _, err := ValidateSession(db, sessionCookie.Value); err != nil {
		t.Fatalf("validate session: %v", err)
	}
	account, err := users.FindByIdentity(context.Background(), user.ProviderDiscord, "discord-existing")
	if err != nil {
		t.Fatalf("find existing discord identity: %v", err)
	}
	if account.DisplayName != "Renamed Player" {
		t.Fatalf("display name = %q, want %q", account.DisplayName, "Renamed Player")
	}
}

func TestDiscordRegistrationGateMisconfigurationFailsClosed(t *testing.T) {
	base := authTestConfig()
	tests := []struct {
		name string
		cfg  config.Config
	}{
		{
			name: "guild without roles",
			cfg: func() config.Config {
				cfg := base
				cfg.DiscordRegistrationGuildID = "guild-id"
				return cfg
			}(),
		},
		{
			name: "roles without guild",
			cfg: func() config.Config {
				cfg := base
				cfg.DiscordRegistrationRoleIDs = []string{"role-id"}
				return cfg
			}(),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeDiscordClient{authorizeURL: "https://discord.example/authorize"}
			handler, _, _ := newAuthTestHandler(t, tt.cfg, fake)
			req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
			rec := httptest.NewRecorder()

			handler.HandleLogin(rec, req)
			res := rec.Result()
			defer res.Body.Close()
			if res.StatusCode != http.StatusServiceUnavailable {
				t.Fatalf("login status = %d, want %d", res.StatusCode, http.StatusServiceUnavailable)
			}
			if fake.authorizeCalls != 0 {
				t.Fatalf("authorize calls = %d, want 0", fake.authorizeCalls)
			}
		})
	}
}

func authTestConfig() config.Config {
	return config.Config{
		BaseURL:             "http://example.test",
		DiscordClientID:     "client-id",
		DiscordClientSecret: "client-secret",
		CookieSecure:        false,
	}
}

func newAuthTestHandler(t *testing.T, cfg config.Config, discord *fakeDiscordClient) (*Handler, *sql.DB, *user.SQLiteRepository) {
	t.Helper()
	db, err := storage.OpenSQLite(context.Background(), filepath.Join(t.TempDir(), "tsian.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	users := user.NewSQLiteRepository(db)
	return &Handler{
		cfg:     cfg,
		db:      db,
		users:   users,
		discord: discord,
	}, db, users
}

func runCallback(t *testing.T, handler *Handler, state string) *http.Response {
	t.Helper()
	callbackURL := "/api/v1/auth/callback?code=oauth-code&state=" + url.QueryEscape(state)
	req := httptest.NewRequest(http.MethodGet, callbackURL, nil)
	req.AddCookie(&http.Cookie{Name: oauthStateCookieName, Value: state})
	rec := httptest.NewRecorder()

	handler.HandleCallback(rec, req)
	res := rec.Result()
	t.Cleanup(func() { _ = res.Body.Close() })
	return res
}

func requireCookie(t *testing.T, cookies []*http.Cookie, name string) *http.Cookie {
	t.Helper()
	cookie := findCookie(cookies, name)
	if cookie == nil {
		t.Fatalf("missing %s cookie", name)
	}
	return cookie
}

func findCookie(cookies []*http.Cookie, name string) *http.Cookie {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

type fakeDiscordClient struct {
	authorizeURL        string
	accessToken         string
	identity            user.DiscordIdentity
	registrationAllowed bool
	registrationErr     error
	authorizeCalls      int
	exchangeCalls       int
	fetchMeCalls        int
	registrationChecks  int
}

func (f *fakeDiscordClient) AuthorizeURL(state string) string {
	f.authorizeCalls++
	if f.authorizeURL != "" {
		return f.authorizeURL
	}
	return "https://discord.example/authorize?state=" + url.QueryEscape(state)
}

func (f *fakeDiscordClient) Exchange(ctx context.Context, code string) (string, error) {
	f.exchangeCalls++
	return f.accessToken, nil
}

func (f *fakeDiscordClient) FetchMe(ctx context.Context, accessToken string) (user.DiscordIdentity, error) {
	f.fetchMeCalls++
	return f.identity, nil
}

func (f *fakeDiscordClient) RegistrationAllowed(ctx context.Context, accessToken string) (bool, error) {
	f.registrationChecks++
	if f.registrationErr != nil {
		return false, f.registrationErr
	}
	return f.registrationAllowed, nil
}
