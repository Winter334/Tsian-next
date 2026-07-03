package server

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"tsian/platform-server/internal/config"
	"tsian/platform-server/internal/storage"

	_ "modernc.org/sqlite"
)

// buildTestPackageZip builds a minimal valid .tsian-card.zip in memory.
// game-card.json stores a GameCardPackageManifest (package schema wrapping
// an inner GameCardManifest), matching what the frontend exports.
func buildTestPackageZip(t *testing.T) []byte {
	t.Helper()
	return buildZip(t, map[string][]byte{
		"game-card.json":      []byte(`{"schema":"tsian.game-card.package.v1","manifest":{"schema":"tsian.game-card.v1","id":"test-card-001","name":"Test Card","version":"0.1.0","summary":"A test game card for integration tests."}}`),
		"workspace/README.md": []byte("# Test Card\n"),
	})
}

func buildResourcePackageZip(t *testing.T, manifest string, files map[string][]byte) []byte {
	t.Helper()
	entries := map[string][]byte{"resource-package.json": []byte(manifest)}
	for path, content := range files {
		entries[path] = content
	}
	return buildZip(t, entries)
}

func buildZip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for path, content := range files {
		f, err := w.Create(path)
		if err != nil {
			t.Fatalf("create zip file %s: %v", path, err)
		}
		if _, err := f.Write(content); err != nil {
			t.Fatalf("write zip file %s: %v", path, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

func newMarketTestServer(t *testing.T) (*httptest.Server, *http.Client) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	db, err := storage.OpenSQLite(ctx, filepath.Join(t.TempDir(), "tsian.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

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
	t.Cleanup(server.Close)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("create cookie jar: %v", err)
	}
	client := server.Client()
	client.Jar = jar
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return server, client
}

func TestMarketUploadListDownload(t *testing.T) {
	t.Parallel()

	server, client := newMarketTestServer(t)

	// Login via mock-login so the session cookie is set.
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/auth/mock-login", http.StatusFound)

	// Empty market list before upload.
	listResp, err := client.Get(server.URL + "/api/v1/market/packages")
	if err != nil {
		t.Fatalf("GET market list: %v", err)
	}
	defer listResp.Body.Close()
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("market list status = %d, want %d", listResp.StatusCode, http.StatusOK)
	}
	var listBody struct {
		Packages []json.RawMessage `json:"packages"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode market list: %v", err)
	}
	if len(listBody.Packages) != 0 {
		t.Fatalf("expected empty market, got %d packages", len(listBody.Packages))
	}

	// Upload without auth should fail — use a plain client with no cookie jar.
	noAuthClient := &http.Client{}
	zipBytes := buildTestPackageZip(t)
	uploadResp := uploadPackage(t, noAuthClient, server.URL+"/api/v1/market/packages", zipBytes, uploadOptions{})
	defer uploadResp.Body.Close()
	if uploadResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("upload without auth status = %d, want %d", uploadResp.StatusCode, http.StatusUnauthorized)
	}

	// Upload with auth.
	uploadResp = uploadPackage(t, client, server.URL+"/api/v1/market/packages", zipBytes, uploadOptions{})
	defer uploadResp.Body.Close()
	if uploadResp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(uploadResp.Body)
		t.Fatalf("upload with auth status = %d, want %d, body: %s", uploadResp.StatusCode, http.StatusCreated, body)
	}
	var pkg struct {
		ID              string   `json:"id"`
		ResourceType    string   `json:"resourceType"`
		ResourceID      string   `json:"resourceId"`
		ResourceVersion string   `json:"resourceVersion"`
		Name            string   `json:"name"`
		Summary         string   `json:"summary"`
		Tags            []string `json:"tags"`
		DownloadCount   int      `json:"downloadCount"`
		Uploader        struct {
			DisplayName string `json:"displayName"`
		} `json:"uploader"`
	}
	if err := json.NewDecoder(uploadResp.Body).Decode(&pkg); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}
	if pkg.ResourceType != "game_card" || pkg.ResourceID != "test-card-001" || pkg.Name != "Test Card" || pkg.ResourceVersion != "0.1.0" {
		t.Fatalf("uploaded package = %+v", pkg)
	}
	if len(pkg.Tags) != 0 {
		t.Fatalf("tags = %+v, want empty", pkg.Tags)
	}
	if pkg.Uploader.DisplayName != "Mock Player" {
		t.Fatalf("uploader displayName = %q, want %q", pkg.Uploader.DisplayName, "Mock Player")
	}

	// List should now contain 1 package.
	listResp2, err := client.Get(server.URL + "/api/v1/market/packages")
	if err != nil {
		t.Fatalf("GET market list after upload: %v", err)
	}
	defer listResp2.Body.Close()
	if err := json.NewDecoder(listResp2.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode market list after upload: %v", err)
	}
	if len(listBody.Packages) != 1 {
		t.Fatalf("expected 1 package, got %d", len(listBody.Packages))
	}

	// Get detail.
	detailResp, err := client.Get(server.URL + "/api/v1/market/packages/" + pkg.ID)
	if err != nil {
		t.Fatalf("GET package detail: %v", err)
	}
	defer detailResp.Body.Close()
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("package detail status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}

	// Download and verify content matches uploaded zip.
	downloadResp, err := client.Get(server.URL + "/api/v1/market/packages/" + pkg.ID + "/download")
	if err != nil {
		t.Fatalf("GET package download: %v", err)
	}
	defer downloadResp.Body.Close()
	if downloadResp.StatusCode != http.StatusOK {
		t.Fatalf("download status = %d, want %d", downloadResp.StatusCode, http.StatusOK)
	}
	if downloadResp.Header.Get("Content-Type") != "application/zip" {
		t.Fatalf("download content-type = %q, want application/zip", downloadResp.Header.Get("Content-Type"))
	}
	if got := downloadResp.Header.Get("Content-Disposition"); got != `attachment; filename="test-card-001.tsian-card.zip"` {
		t.Fatalf("download disposition = %q", got)
	}
	downloadedBytes, err := io.ReadAll(downloadResp.Body)
	if err != nil {
		t.Fatalf("read download body: %v", err)
	}
	if !bytes.Equal(downloadedBytes, zipBytes) {
		t.Fatalf("downloaded content does not match uploaded zip (len %d vs %d)", len(downloadedBytes), len(zipBytes))
	}

	// Verify download count incremented — re-fetch detail.
	detailResp2, err := client.Get(server.URL + "/api/v1/market/packages/" + pkg.ID)
	if err != nil {
		t.Fatalf("GET package detail after download: %v", err)
	}
	defer detailResp2.Body.Close()
	var pkgAfterDownload struct {
		DownloadCount int `json:"downloadCount"`
	}
	if err := json.NewDecoder(detailResp2.Body).Decode(&pkgAfterDownload); err != nil {
		t.Fatalf("decode detail after download: %v", err)
	}
	if pkgAfterDownload.DownloadCount != 1 {
		t.Fatalf("download count = %d, want 1", pkgAfterDownload.DownloadCount)
	}
}

type uploadOptions struct {
	ResourceType string
	Title        string
	Summary      string
	Author       string
	Version      string
	Tags         string
}

// uploadPackage POSTs a multipart upload to the market packages endpoint.
func uploadPackage(t *testing.T, client *http.Client, url string, zipBytes []byte, options uploadOptions) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	field, err := mw.CreateFormFile("file", "test.zip")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := field.Write(zipBytes); err != nil {
		t.Fatalf("write zip to form: %v", err)
	}
	writeField := func(name, value string) {
		if value != "" {
			_ = mw.WriteField(name, value)
		}
	}
	writeField("resourceType", options.ResourceType)
	writeField("title", options.Title)
	writeField("summary", options.Summary)
	writeField("author", options.Author)
	writeField("version", options.Version)
	writeField("tags", options.Tags)
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, url, &buf)
	if err != nil {
		t.Fatalf("create upload request: %v", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("upload request: %v", err)
	}
	return res
}

func TestMarketSearch(t *testing.T) {
	t.Parallel()

	server, client := newMarketTestServer(t)
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/auth/mock-login", http.StatusFound)

	// Upload a package with a distinctive name.
	zipBytes := buildTestPackageZip(t)
	uploadResp := uploadPackage(t, client, server.URL+"/api/v1/market/packages", zipBytes, uploadOptions{Title: "Custom Title", Summary: "Custom summary text"})
	defer uploadResp.Body.Close()
	if uploadResp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(uploadResp.Body)
		t.Fatalf("upload status = %d, body: %s", uploadResp.StatusCode, body)
	}

	// Search by custom title — should find it.
	searchResp, err := client.Get(server.URL + "/api/v1/market/packages?q=Custom")
	if err != nil {
		t.Fatalf("search request: %v", err)
	}
	defer searchResp.Body.Close()
	var listBody struct {
		Packages []struct {
			Name string `json:"name"`
		} `json:"packages"`
	}
	if err := json.NewDecoder(searchResp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode search response: %v", err)
	}
	if len(listBody.Packages) != 1 || listBody.Packages[0].Name != "Custom Title" {
		t.Fatalf("search result = %+v", listBody.Packages)
	}

	// Search with non-matching query — should be empty.
	searchResp2, err := client.Get(server.URL + "/api/v1/market/packages?q=nonexistent")
	if err != nil {
		t.Fatalf("search request 2: %v", err)
	}
	defer searchResp2.Body.Close()
	if err := json.NewDecoder(searchResp2.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode search response 2: %v", err)
	}
	if len(listBody.Packages) != 0 {
		t.Fatalf("expected 0 results for nonexistent query, got %d", len(listBody.Packages))
	}
}

func TestMarketResourcePackages(t *testing.T) {
	t.Parallel()

	server, client := newMarketTestServer(t)
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/auth/mock-login", http.StatusFound)

	agentZip := buildResourcePackageZip(t,
		`{"schema":"tsian.resource.package.v1","resourceType":"agent","resourceId":"story-master","name":"Story Master","summary":"Runs the story.","author":"Author A","version":"1.2.0","files":[{"path":"agent.json","mediaType":"application/json"},{"path":"AGENT.md","mediaType":"text/markdown"},{"path":"skills/local-skill/SKILL.md","mediaType":"text/markdown"}]}`,
		map[string][]byte{
			"agent.json":                  []byte(`{"id":"story-master","title":"Story Master","summary":"Runs the story.","contacts":[],"contextPaths":[],"skills":{"enabled":[],"disabled":[]},"platformTools":{"enabled":[],"disabled":[]},"workspaceAccess":{"level":1}}`),
			"AGENT.md":                    []byte("# Story Master\n"),
			"skills/local-skill/SKILL.md": []byte("---\nname: local-skill\ntitle: Local Skill\ndescription: Local helper\n---\n# Local Skill\n"),
		},
	)
	agentResp := uploadPackage(t, client, server.URL+"/api/v1/market/packages", agentZip, uploadOptions{ResourceType: "agent", Tags: "Tool, storyteller,工具, tool"})
	defer agentResp.Body.Close()
	if agentResp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(agentResp.Body)
		t.Fatalf("agent upload status = %d, body: %s", agentResp.StatusCode, body)
	}
	var agentPkg struct {
		ID             string   `json:"id"`
		ResourceType   string   `json:"resourceType"`
		ResourceID     string   `json:"resourceId"`
		ResourceAuthor string   `json:"resourceAuthor"`
		Tags           []string `json:"tags"`
	}
	if err := json.NewDecoder(agentResp.Body).Decode(&agentPkg); err != nil {
		t.Fatalf("decode agent upload: %v", err)
	}
	if agentPkg.ResourceType != "agent" || agentPkg.ResourceID != "story-master" || agentPkg.ResourceAuthor != "Author A" {
		t.Fatalf("agent package = %+v", agentPkg)
	}
	wantTags := []string{"tool", "storyteller", "工具"}
	if !stringSlicesEqual(agentPkg.Tags, wantTags) {
		t.Fatalf("agent tags = %+v, want %+v", agentPkg.Tags, wantTags)
	}

	skillZip := buildResourcePackageZip(t,
		`{"schema":"tsian.resource.package.v1","resourceType":"skill","resourceId":"web-search","name":"Web Search","summary":"Searches the web.","author":"Author B","version":"0.3.0","files":[{"path":"SKILL.md","mediaType":"text/markdown"},{"path":"skill.config","mediaType":"text/plain"}]}`,
		map[string][]byte{
			"SKILL.md":     []byte("---\nname: web-search\ntitle: Web Search\ndescription: Searches the web\n---\n# Web Search\n"),
			"skill.config": []byte("# API key\nAPI_KEY=\n"),
		},
	)
	skillResp := uploadPackage(t, client, server.URL+"/api/v1/market/packages", skillZip, uploadOptions{ResourceType: "skill", Tags: `[
		"tool", "utility"
	]`})
	defer skillResp.Body.Close()
	if skillResp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(skillResp.Body)
		t.Fatalf("skill upload status = %d, body: %s", skillResp.StatusCode, body)
	}

	agentListResp, err := client.Get(server.URL + "/api/v1/market/packages?resourceType=agent")
	if err != nil {
		t.Fatalf("list agents: %v", err)
	}
	defer agentListResp.Body.Close()
	var listBody struct {
		Packages []struct {
			ResourceType string `json:"resourceType"`
			ResourceID   string `json:"resourceId"`
		} `json:"packages"`
	}
	if err := json.NewDecoder(agentListResp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode agent list: %v", err)
	}
	if len(listBody.Packages) != 1 || listBody.Packages[0].ResourceType != "agent" || listBody.Packages[0].ResourceID != "story-master" {
		t.Fatalf("agent list = %+v", listBody.Packages)
	}

	tagResp, err := client.Get(server.URL + "/api/v1/market/packages?resourceType=agent&tag=tool")
	if err != nil {
		t.Fatalf("tag filter: %v", err)
	}
	defer tagResp.Body.Close()
	if err := json.NewDecoder(tagResp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode tag list: %v", err)
	}
	if len(listBody.Packages) != 1 || listBody.Packages[0].ResourceID != "story-master" {
		t.Fatalf("agent tag list = %+v", listBody.Packages)
	}

	downloadResp, err := client.Get(server.URL + "/api/v1/market/packages/" + agentPkg.ID + "/download")
	if err != nil {
		t.Fatalf("download agent: %v", err)
	}
	defer downloadResp.Body.Close()
	if got := downloadResp.Header.Get("Content-Disposition"); got != `attachment; filename="story-master.tsian-agent.zip"` {
		t.Fatalf("agent download disposition = %q", got)
	}
	downloadedBytes, err := io.ReadAll(downloadResp.Body)
	if err != nil {
		t.Fatalf("read agent download: %v", err)
	}
	if !bytes.Equal(downloadedBytes, agentZip) {
		t.Fatalf("agent download content mismatch")
	}
}

func TestMarketResourcePackageValidation(t *testing.T) {
	t.Parallel()

	server, client := newMarketTestServer(t)
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/auth/mock-login", http.StatusFound)

	validAgent := func() []byte {
		return buildResourcePackageZip(t,
			`{"schema":"tsian.resource.package.v1","resourceType":"agent","resourceId":"agent-a","name":"Agent A","summary":"Agent summary.","author":"Author","version":"1.0.0","files":[{"path":"agent.json"},{"path":"AGENT.md"}]}`,
			map[string][]byte{
				"agent.json": []byte(`{"id":"agent-a"}`),
				"AGENT.md":   []byte("# Agent A\n"),
			},
		)
	}

	cases := []struct {
		name         string
		resourceType string
		zipBytes     []byte
		tags         string
	}{
		{
			name:         "unknown resource type",
			resourceType: "unknown",
			zipBytes:     validAgent(),
		},
		{
			name:         "missing resource manifest",
			resourceType: "agent",
			zipBytes: buildZip(t, map[string][]byte{
				"agent.json": []byte(`{"id":"agent-a"}`),
				"AGENT.md":   []byte("# Agent A\n"),
			}),
		},
		{
			name:         "wrong schema",
			resourceType: "agent",
			zipBytes: buildResourcePackageZip(t,
				`{"schema":"wrong","resourceType":"agent","resourceId":"agent-a","name":"Agent A","summary":"Agent summary.","author":"Author","version":"1.0.0","files":[{"path":"agent.json"},{"path":"AGENT.md"}]}`,
				map[string][]byte{"agent.json": []byte(`{"id":"agent-a"}`), "AGENT.md": []byte("# Agent A\n")},
			),
		},
		{
			name:         "resource type mismatch",
			resourceType: "agent",
			zipBytes: buildResourcePackageZip(t,
				`{"schema":"tsian.resource.package.v1","resourceType":"skill","resourceId":"skill-a","name":"Skill A","summary":"Skill summary.","author":"Author","version":"1.0.0","files":[{"path":"SKILL.md"}]}`,
				map[string][]byte{"SKILL.md": []byte("# Skill A\n")},
			),
		},
		{
			name:         "missing required file",
			resourceType: "agent",
			zipBytes: buildResourcePackageZip(t,
				`{"schema":"tsian.resource.package.v1","resourceType":"agent","resourceId":"agent-a","name":"Agent A","summary":"Agent summary.","author":"Author","version":"1.0.0","files":[{"path":"agent.json"}]}`,
				map[string][]byte{"agent.json": []byte(`{"id":"agent-a"}`)},
			),
		},
		{
			name:         "unsafe path",
			resourceType: "agent",
			zipBytes: buildResourcePackageZip(t,
				`{"schema":"tsian.resource.package.v1","resourceType":"agent","resourceId":"agent-a","name":"Agent A","summary":"Agent summary.","author":"Author","version":"1.0.0","files":[{"path":"agent.json"},{"path":"../AGENT.md"}]}`,
				map[string][]byte{"agent.json": []byte(`{"id":"agent-a"}`), "AGENT.md": []byte("# Agent A\n")},
			),
		},
		{
			name:         "manifest lists missing file",
			resourceType: "agent",
			zipBytes: buildResourcePackageZip(t,
				`{"schema":"tsian.resource.package.v1","resourceType":"agent","resourceId":"agent-a","name":"Agent A","summary":"Agent summary.","author":"Author","version":"1.0.0","files":[{"path":"agent.json"},{"path":"AGENT.md"},{"path":"SOUL.md"}]}`,
				map[string][]byte{"agent.json": []byte(`{"id":"agent-a"}`), "AGENT.md": []byte("# Agent A\n")},
			),
		},
		{
			name:         "unlisted file",
			resourceType: "agent",
			zipBytes: buildResourcePackageZip(t,
				`{"schema":"tsian.resource.package.v1","resourceType":"agent","resourceId":"agent-a","name":"Agent A","summary":"Agent summary.","author":"Author","version":"1.0.0","files":[{"path":"agent.json"},{"path":"AGENT.md"}]}`,
				map[string][]byte{"agent.json": []byte(`{"id":"agent-a"}`), "AGENT.md": []byte("# Agent A\n"), "extra.md": []byte("extra")},
			),
		},
		{
			name:         "invalid utf8",
			resourceType: "agent",
			zipBytes: buildResourcePackageZip(t,
				`{"schema":"tsian.resource.package.v1","resourceType":"agent","resourceId":"agent-a","name":"Agent A","summary":"Agent summary.","author":"Author","version":"1.0.0","files":[{"path":"agent.json"},{"path":"AGENT.md"}]}`,
				map[string][]byte{"agent.json": []byte(`{"id":"agent-a"}`), "AGENT.md": {0xff, 0xfe}},
			),
		},
		{
			name:         "invalid tag",
			resourceType: "agent",
			zipBytes:     validAgent(),
			tags:         "bad%tag",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := uploadPackage(t, client, server.URL+"/api/v1/market/packages", tc.zipBytes, uploadOptions{ResourceType: tc.resourceType, Tags: tc.tags})
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				body, _ := io.ReadAll(resp.Body)
				t.Fatalf("status = %d, want %d, body: %s", resp.StatusCode, http.StatusBadRequest, body)
			}
		})
	}

	badTypeResp, err := client.Get(server.URL + "/api/v1/market/packages?resourceType=unknown")
	if err != nil {
		t.Fatalf("list bad resource type: %v", err)
	}
	defer badTypeResp.Body.Close()
	if badTypeResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad resource type status = %d", badTypeResp.StatusCode)
	}

	badTagResp, err := client.Get(server.URL + "/api/v1/market/packages?tag=bad%25tag")
	if err != nil {
		t.Fatalf("list bad tag: %v", err)
	}
	defer badTagResp.Body.Close()
	if badTagResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad tag status = %d", badTagResp.StatusCode)
	}
}

func TestMarketSchemaMigrationBackfillsResourceColumns(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	legacyDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy sqlite: %v", err)
	}
	_, err = legacyDB.Exec(`CREATE TABLE users (
		id TEXT PRIMARY KEY,
		handle TEXT NOT NULL UNIQUE,
		display_name TEXT NOT NULL,
		avatar_url TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`)
	if err != nil {
		t.Fatalf("create legacy users: %v", err)
	}
	_, err = legacyDB.Exec(`CREATE TABLE market_packages (
		id TEXT PRIMARY KEY,
		resource_type TEXT NOT NULL DEFAULT 'game_card',
		card_id TEXT NOT NULL,
		card_author TEXT NOT NULL DEFAULT '',
		card_version TEXT NOT NULL DEFAULT '',
		name TEXT NOT NULL,
		summary TEXT NOT NULL,
		cover_blob_key TEXT,
		uploader_id TEXT NOT NULL,
		download_count INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`)
	if err != nil {
		t.Fatalf("create legacy market_packages: %v", err)
	}
	_, err = legacyDB.Exec(`INSERT INTO users (id, handle, display_name, created_at, updated_at) VALUES ('user-1', 'legacy', 'Legacy User', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatalf("insert legacy user: %v", err)
	}
	_, err = legacyDB.Exec(`INSERT INTO market_packages (id, resource_type, card_id, card_author, card_version, name, summary, uploader_id, created_at, updated_at)
		VALUES ('pkg-1', 'game_card', 'legacy-card', 'Legacy Author', '0.1.0', 'Legacy Card', 'Legacy summary', 'user-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatalf("insert legacy package: %v", err)
	}
	if err := legacyDB.Close(); err != nil {
		t.Fatalf("close legacy db: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := storage.OpenSQLite(ctx, dbPath)
	if err != nil {
		t.Fatalf("migrate legacy db: %v", err)
	}
	defer db.Close()

	var resourceID, resourceAuthor, resourceVersion, tags string
	if err := db.QueryRowContext(ctx, `SELECT resource_id, resource_author, resource_version, tags FROM market_packages WHERE id = 'pkg-1'`).Scan(&resourceID, &resourceAuthor, &resourceVersion, &tags); err != nil {
		t.Fatalf("read migrated package: %v", err)
	}
	if resourceID != "legacy-card" || resourceAuthor != "Legacy Author" || resourceVersion != "0.1.0" || tags != "[]" {
		t.Fatalf("migrated values = id:%q author:%q version:%q tags:%q", resourceID, resourceAuthor, resourceVersion, tags)
	}
}

func stringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
