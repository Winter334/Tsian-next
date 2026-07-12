package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"tsian/platform-server/internal/config"
	"tsian/platform-server/internal/storage"
)

func newAdminTestServer(t *testing.T, adminDiscordIDs ...string) (*httptest.Server, *sql.DB) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	db, err := storage.OpenSQLite(ctx, filepath.Join(t.TempDir(), "tsian.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	cfg := config.Config{
		Addr:            ":0",
		BaseURL:         "http://example.test",
		AdminDiscordIDs: adminDiscordIDs,
		DBPath:          filepath.Join(t.TempDir(), "tsian.db"),
		DataDir:         t.TempDir(),
		StaticDir:       t.TempDir(),
		AdminStaticDir:  t.TempDir(),
		CookieSecure:    false,
		MockAuth:        true,
	}
	server := httptest.NewServer(New(cfg, db).Handler())
	t.Cleanup(server.Close)
	return server, db
}

func TestAdminMeAuthorization(t *testing.T) {
	t.Parallel()

	server, db := newAdminTestServer(t, "admin-subject")
	client := newMarketHTTPClient(t, server)

	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/admin/me", http.StatusUnauthorized)

	loginTestUser(t, db, client, server.URL, "ordinary", "Ordinary Player")
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/admin/me", http.StatusForbidden)

	adminClient := newMarketHTTPClient(t, server)
	loginTestUser(t, db, adminClient, server.URL, "admin-subject", "Admin Player")
	res, err := adminClient.Get(server.URL + "/api/v1/admin/me")
	if err != nil {
		t.Fatalf("admin me request: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("admin me status = %d, want %d", res.StatusCode, http.StatusOK)
	}
	var body struct {
		IsAdmin bool `json:"isAdmin"`
		User    struct {
			DisplayName string `json:"displayName"`
		} `json:"user"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode admin me: %v", err)
	}
	if !body.IsAdmin || body.User.DisplayName != "Admin Player" {
		t.Fatalf("admin me body = %+v", body)
	}
}

func TestAdminMarketHideMetadataAndDelete(t *testing.T) {
	t.Parallel()

	server, db := newAdminTestServer(t, "admin-subject")
	ownerClient := newMarketHTTPClient(t, server)
	loginTestUser(t, db, ownerClient, server.URL, "owner", "Owner Player")
	pkg := mustUploadPackage(t, ownerClient, server.URL,
		buildGameCardPackageZip(t, "admin-card", "Admin Card", "1.0.0", "Original summary."),
		uploadOptions{Tags: "old"},
	)

	adminClient := newMarketHTTPClient(t, server)
	loginTestUser(t, db, adminClient, server.URL, "admin-subject", "Admin Player")

	updateBody := []byte(`{"name":"Reviewed Card","summary":"Reviewed summary.","tags":["reviewed","safe"]}`)
	updateReq, err := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/admin/market/packages/"+pkg.ID, bytes.NewReader(updateBody))
	if err != nil {
		t.Fatalf("create admin update request: %v", err)
	}
	updateReq.Header.Set("Content-Type", "application/json")
	updateResp, err := adminClient.Do(updateReq)
	if err != nil {
		t.Fatalf("admin update request: %v", err)
	}
	defer updateResp.Body.Close()
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("admin update status = %d, want %d", updateResp.StatusCode, http.StatusOK)
	}
	var updated packageBody
	if err := json.NewDecoder(updateResp.Body).Decode(&updated); err != nil {
		t.Fatalf("decode admin update: %v", err)
	}
	if updated.Name != "Reviewed Card" || updated.Summary != "Reviewed summary." || !stringSlicesEqual(updated.Tags, []string{"reviewed", "safe"}) {
		t.Fatalf("updated package = %+v", updated)
	}

	assertStatus(t, adminClient, http.MethodPost, server.URL+"/api/v1/admin/market/packages/"+pkg.ID+"/hide", http.StatusOK)
	assertStatus(t, ownerClient, http.MethodGet, server.URL+"/api/v1/market/packages/"+pkg.ID, http.StatusNotFound)
	assertStatus(t, ownerClient, http.MethodGet, server.URL+"/api/v1/market/packages/"+pkg.ID+"/download", http.StatusNotFound)

	hiddenResp, err := adminClient.Get(server.URL + "/api/v1/admin/market/packages?visibility=hidden")
	if err != nil {
		t.Fatalf("admin hidden list: %v", err)
	}
	defer hiddenResp.Body.Close()
	var hiddenList struct {
		Packages []struct {
			ID       string  `json:"id"`
			HiddenAt *string `json:"hiddenAt"`
		} `json:"packages"`
	}
	if err := json.NewDecoder(hiddenResp.Body).Decode(&hiddenList); err != nil {
		t.Fatalf("decode hidden list: %v", err)
	}
	if len(hiddenList.Packages) != 1 || hiddenList.Packages[0].ID != pkg.ID || hiddenList.Packages[0].HiddenAt == nil {
		t.Fatalf("hidden list = %+v", hiddenList.Packages)
	}

	assertStatus(t, adminClient, http.MethodPost, server.URL+"/api/v1/admin/market/packages/"+pkg.ID+"/unhide", http.StatusOK)
	assertStatus(t, ownerClient, http.MethodGet, server.URL+"/api/v1/market/packages/"+pkg.ID, http.StatusOK)

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/api/v1/admin/market/packages/"+pkg.ID, nil)
	if err != nil {
		t.Fatalf("create admin delete request: %v", err)
	}
	deleteResp, err := adminClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("admin delete request: %v", err)
	}
	deleteResp.Body.Close()
	if deleteResp.StatusCode != http.StatusNoContent {
		t.Fatalf("admin delete status = %d, want %d", deleteResp.StatusCode, http.StatusNoContent)
	}
	assertStatus(t, adminClient, http.MethodGet, server.URL+"/api/v1/admin/market/packages/"+pkg.ID, http.StatusNotFound)
}

func TestAnnouncementAdminAndPublicFlow(t *testing.T) {
	t.Parallel()

	server, db := newAdminTestServer(t, "admin-subject")
	ordinaryClient := newMarketHTTPClient(t, server)
	loginTestUser(t, db, ordinaryClient, server.URL, "ordinary", "Ordinary Player")

	createBody := []byte(`{"title":"维护通知","body":"# 今晚维护\n\n- 预计 10 分钟"}`)
	ordinaryReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/admin/announcements", bytes.NewReader(createBody))
	if err != nil {
		t.Fatalf("create ordinary announcement request: %v", err)
	}
	ordinaryReq.Header.Set("Content-Type", "application/json")
	ordinaryResp, err := ordinaryClient.Do(ordinaryReq)
	if err != nil {
		t.Fatalf("ordinary announcement request: %v", err)
	}
	ordinaryResp.Body.Close()
	if ordinaryResp.StatusCode != http.StatusForbidden {
		t.Fatalf("ordinary announcement status = %d, want %d", ordinaryResp.StatusCode, http.StatusForbidden)
	}

	adminClient := newMarketHTTPClient(t, server)
	loginTestUser(t, db, adminClient, server.URL, "admin-subject", "Admin Player")
	createReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/admin/announcements", bytes.NewReader(createBody))
	if err != nil {
		t.Fatalf("create admin announcement request: %v", err)
	}
	createReq.Header.Set("Content-Type", "application/json")
	createResp, err := adminClient.Do(createReq)
	if err != nil {
		t.Fatalf("admin announcement request: %v", err)
	}
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("admin create announcement status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}
	var created struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatalf("decode created announcement: %v", err)
	}
	if created.ID == "" || created.Title != "维护通知" || created.Body == "" {
		t.Fatalf("created announcement = %+v", created)
	}

	publicResp, err := http.Get(server.URL + "/api/v1/announcements")
	if err != nil {
		t.Fatalf("public announcements request: %v", err)
	}
	defer publicResp.Body.Close()
	var publicList struct {
		Announcements []struct {
			ID string `json:"id"`
		} `json:"announcements"`
	}
	if err := json.NewDecoder(publicResp.Body).Decode(&publicList); err != nil {
		t.Fatalf("decode public announcements: %v", err)
	}
	if len(publicList.Announcements) != 1 || publicList.Announcements[0].ID != created.ID {
		t.Fatalf("public announcements = %+v", publicList.Announcements)
	}

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/api/v1/admin/announcements/"+created.ID, nil)
	if err != nil {
		t.Fatalf("create delete announcement request: %v", err)
	}
	deleteResp, err := adminClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("delete announcement request: %v", err)
	}
	deleteResp.Body.Close()
	if deleteResp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete announcement status = %d, want %d", deleteResp.StatusCode, http.StatusNoContent)
	}
}

func TestPresenceHeartbeatSummary(t *testing.T) {
	t.Parallel()

	server, db := newAdminTestServer(t, "admin-subject")
	client := newMarketHTTPClient(t, server)

	resp, err := client.Post(server.URL+"/api/v1/presence/heartbeat", "application/json", nil)
	if err != nil {
		t.Fatalf("heartbeat request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("heartbeat status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var summary struct {
		OnlineCount int `json:"onlineCount"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&summary); err != nil {
		t.Fatalf("decode heartbeat summary: %v", err)
	}
	if summary.OnlineCount != 1 {
		t.Fatalf("online count after first heartbeat = %d, want 1", summary.OnlineCount)
	}

	resp2, err := client.Post(server.URL+"/api/v1/presence/heartbeat", "application/json", nil)
	if err != nil {
		t.Fatalf("second heartbeat request: %v", err)
	}
	defer resp2.Body.Close()
	if err := json.NewDecoder(resp2.Body).Decode(&summary); err != nil {
		t.Fatalf("decode second heartbeat summary: %v", err)
	}
	if summary.OnlineCount != 1 {
		t.Fatalf("online count after repeated heartbeat = %d, want 1", summary.OnlineCount)
	}

	otherClient := newMarketHTTPClient(t, server)
	resp3, err := otherClient.Post(server.URL+"/api/v1/presence/heartbeat", "application/json", nil)
	if err != nil {
		t.Fatalf("other heartbeat request: %v", err)
	}
	defer resp3.Body.Close()
	if err := json.NewDecoder(resp3.Body).Decode(&summary); err != nil {
		t.Fatalf("decode other heartbeat summary: %v", err)
	}
	if summary.OnlineCount != 2 {
		t.Fatalf("online count after second client = %d, want 2", summary.OnlineCount)
	}

	old := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	if _, err := db.Exec(`INSERT INTO presence_sessions (id, last_seen_at, created_at) VALUES ('old-session', ?, ?)`, old, old); err != nil {
		t.Fatalf("insert old presence row: %v", err)
	}
	summaryResp, err := http.Get(server.URL + "/api/v1/presence/summary")
	if err != nil {
		t.Fatalf("presence summary request: %v", err)
	}
	defer summaryResp.Body.Close()
	if err := json.NewDecoder(summaryResp.Body).Decode(&summary); err != nil {
		t.Fatalf("decode presence summary: %v", err)
	}
	if summary.OnlineCount != 2 {
		t.Fatalf("online count with old row = %d, want 2", summary.OnlineCount)
	}
}
