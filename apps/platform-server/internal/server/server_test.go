package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tsian/platform-server/internal/config"
	"tsian/platform-server/internal/storage"
)

func TestPlatformWebStaticResponsesUseProductionCSP(t *testing.T) {
	t.Parallel()

	staticDir := t.TempDir()
	adminDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("platform index"), 0o600); err != nil {
		t.Fatalf("write platform index: %v", err)
	}
	if err := os.WriteFile(filepath.Join(staticDir, "app.js"), []byte("export {}"), 0o600); err != nil {
		t.Fatalf("write platform asset: %v", err)
	}
	if err := os.WriteFile(filepath.Join(adminDir, "index.html"), []byte("admin index"), 0o600); err != nil {
		t.Fatalf("write admin index: %v", err)
	}

	cfg := config.Config{
		DataDir:        t.TempDir(),
		StaticDir:      staticDir,
		AdminStaticDir: adminDir,
	}
	handler := New(cfg, nil).Handler()
	expectedCSP := strings.TrimSpace(platformWebContentSecurityPolicy)
	for _, requestPath := range []string{"/", "/app.js", "/client/route"} {
		request := httptest.NewRequest(http.MethodGet, requestPath, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, want %d", requestPath, response.Code, http.StatusOK)
		}
		if got := response.Header().Get("Content-Security-Policy"); got != expectedCSP {
			t.Fatalf("GET %s CSP = %q, want %q", requestPath, got, expectedCSP)
		}
	}

	adminRequest := httptest.NewRequest(http.MethodGet, "/admin/", nil)
	adminResponse := httptest.NewRecorder()
	handler.ServeHTTP(adminResponse, adminRequest)
	if got := adminResponse.Header().Get("Content-Security-Policy"); got != "" {
		t.Fatalf("admin CSP = %q, want no platform-web policy", got)
	}
}

func TestAuthMockLoginMeLogout(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	db, err := storage.OpenSQLite(ctx, filepath.Join(t.TempDir(), "tsian.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()

	cfg := config.Config{
		Addr:         ":0",
		BaseURL:      "http://example.test",
		DBPath:       filepath.Join(t.TempDir(), "tsian.db"),
		DataDir:      t.TempDir(),
		StaticDir:    t.TempDir(),
		CookieSecure: false,
		MockAuth:     true,
	}
	server := httptest.NewServer(New(cfg, db).Handler())
	defer server.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("create cookie jar: %v", err)
	}
	client := server.Client()
	client.Jar = jar
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}

	assertStatus(t, client, http.MethodGet, server.URL+"/healthz", http.StatusOK)
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/auth/me", http.StatusUnauthorized)
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/auth/mock-login", http.StatusFound)

	meResponse, err := client.Get(server.URL + "/api/v1/auth/me")
	if err != nil {
		t.Fatalf("GET /me after login: %v", err)
	}
	defer meResponse.Body.Close()
	if meResponse.StatusCode != http.StatusOK {
		t.Fatalf("GET /me after login status = %d, want %d", meResponse.StatusCode, http.StatusOK)
	}
	var body struct {
		Handle        string   `json:"handle"`
		DisplayName   string   `json:"displayName"`
		AuthProviders []string `json:"authProviders"`
	}
	if err := json.NewDecoder(meResponse.Body).Decode(&body); err != nil {
		t.Fatalf("decode /me response: %v", err)
	}
	if body.Handle != "discord-mock-discord-user" || body.DisplayName != "Mock Player" {
		t.Fatalf("/me response = %+v", body)
	}
	if len(body.AuthProviders) != 1 || body.AuthProviders[0] != "discord" {
		t.Fatalf("/me authProviders = %v", body.AuthProviders)
	}

	assertStatus(t, client, http.MethodPost, server.URL+"/api/v1/auth/logout", http.StatusNoContent)
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/auth/me", http.StatusUnauthorized)
}

func assertStatus(t *testing.T, client *http.Client, method string, url string, expected int) {
	t.Helper()
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		t.Fatalf("create %s %s request: %v", method, url, err)
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer res.Body.Close()
	if res.StatusCode != expected {
		t.Fatalf("%s %s status = %d, want %d", method, url, res.StatusCode, expected)
	}
}
