package auth

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"tsian/platform-server/internal/config"
)

func TestDiscordRegistrationAllowedChecksMemberRoles(t *testing.T) {
	cfg := config.Config{
		DiscordRegistrationGuildID: "guild-id",
		DiscordRegistrationRoleIDs: []string{"allowed-role", "other-role"},
	}
	var requestedPath string
	var authHeader string
	client := &DiscordClient{
		cfg: cfg,
		httpClient: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			requestedPath = req.URL.Path
			authHeader = req.Header.Get("Authorization")
			return jsonResponse(http.StatusOK, `{"roles":["member-role","allowed-role"]}`), nil
		})},
	}

	allowed, err := client.RegistrationAllowed(t.Context(), "access-token")
	if err != nil {
		t.Fatalf("RegistrationAllowed returned error: %v", err)
	}
	if !allowed {
		t.Fatalf("RegistrationAllowed = false, want true")
	}
	if requestedPath != "/api/users/@me/guilds/guild-id/member" {
		t.Fatalf("requested path = %q, want %q", requestedPath, "/api/users/@me/guilds/guild-id/member")
	}
	if authHeader != "Bearer access-token" {
		t.Fatalf("Authorization header = %q, want %q", authHeader, "Bearer access-token")
	}
}

func TestDiscordRegistrationAllowedDeniesMissingRole(t *testing.T) {
	cfg := config.Config{
		DiscordRegistrationGuildID: "guild-id",
		DiscordRegistrationRoleIDs: []string{"allowed-role"},
	}
	client := &DiscordClient{
		cfg: cfg,
		httpClient: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusOK, `{"roles":["member-role"]}`), nil
		})},
	}

	allowed, err := client.RegistrationAllowed(t.Context(), "access-token")
	if err != nil {
		t.Fatalf("RegistrationAllowed returned error: %v", err)
	}
	if allowed {
		t.Fatalf("RegistrationAllowed = true, want false")
	}
}

func TestDiscordRegistrationAllowedDeniesMissingMember(t *testing.T) {
	cfg := config.Config{
		DiscordRegistrationGuildID: "guild-id",
		DiscordRegistrationRoleIDs: []string{"allowed-role"},
	}
	client := &DiscordClient{
		cfg: cfg,
		httpClient: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusNotFound, `{"message":"unknown member"}`), nil
		})},
	}

	allowed, err := client.RegistrationAllowed(t.Context(), "access-token")
	if err != nil {
		t.Fatalf("RegistrationAllowed returned error: %v", err)
	}
	if allowed {
		t.Fatalf("RegistrationAllowed = true, want false")
	}
}

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}
