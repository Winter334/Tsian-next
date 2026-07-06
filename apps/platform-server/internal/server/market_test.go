package server

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"tsian/platform-server/internal/auth"
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

func buildGameCardPackageZip(t *testing.T, id string, name string, version string, summary string) []byte {
	t.Helper()
	manifest := fmt.Sprintf(`{"schema":"tsian.game-card.package.v1","manifest":{"schema":"tsian.game-card.v1","id":%q,"name":%q,"version":%q,"summary":%q}}`, id, name, version, summary)
	return buildZip(t, map[string][]byte{
		"game-card.json":      []byte(manifest),
		"workspace/README.md": []byte("# " + name + "\n"),
	})
}

func buildTestPackageZipWithCover(t *testing.T) []byte {
	t.Helper()
	return buildZip(t, map[string][]byte{
		"game-card.json":      []byte(`{"schema":"tsian.game-card.package.v1","manifest":{"schema":"tsian.game-card.v1","id":"test-card-001","name":"Test Card","version":"0.1.0","summary":"A test game card for integration tests.","cover":{"workspacePath":".cover/cover.png","alt":"Test Cover"}},"coverFiles":[{"path":"cover/cover.png","mediaType":"image/png","size":1}]}`),
		"workspace/README.md": []byte("# Test Card\n"),
		"cover/cover.png":     buildTestPNG(t),
	})
}

func buildTestPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 32, 40))
	for y := 0; y < 40; y++ {
		for x := 0; x < 32; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 8), G: uint8(y * 6), B: 180, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode test png: %v", err)
	}
	return buf.Bytes()
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
	server, client, _ := newMarketTestServerWithDB(t)
	return server, client
}

func newMarketTestServerWithDB(t *testing.T) (*httptest.Server, *http.Client, *sql.DB) {
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

	client := newMarketHTTPClient(t, server)
	return server, client, db
}

func newMarketHTTPClient(t *testing.T, server *httptest.Server) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("create cookie jar: %v", err)
	}
	client := &http.Client{Transport: server.Client().Transport}
	client.Jar = jar
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return client
}

func loginMockUser(t *testing.T, client *http.Client, serverURL string) {
	t.Helper()
	assertStatus(t, client, http.MethodGet, serverURL+"/api/v1/auth/mock-login", http.StatusFound)
}

func loginTestUser(t *testing.T, db *sql.DB, client *http.Client, serverURL string, subject string, displayName string) string {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339)
	userID := "test-user-" + subject
	identityID := "identity-" + subject
	if _, err := db.Exec(`INSERT INTO users (id, handle, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, userID, "test-"+subject, displayName, now, now); err != nil {
		t.Fatalf("insert test user: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO auth_identities (id, user_id, provider, subject, created_at, updated_at) VALUES (?, ?, 'discord', ?, ?, ?)`, identityID, userID, subject, now, now); err != nil {
		t.Fatalf("insert test identity: %v", err)
	}
	token, err := auth.CreateSession(db, userID)
	if err != nil {
		t.Fatalf("create test session: %v", err)
	}
	parsedURL, err := url.Parse(serverURL)
	if err != nil {
		t.Fatalf("parse server url: %v", err)
	}
	client.Jar.SetCookies(parsedURL, []*http.Cookie{{Name: auth.SessionCookieName, Value: token, Path: "/"}})
	return userID
}

func TestMarketUploadListDownload(t *testing.T) {
	t.Parallel()

	server, client := newMarketTestServer(t)

	// Login via mock-login so the session cookie is set.
	loginMockUser(t, client, server.URL)

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

type packageBody struct {
	ID              string   `json:"id"`
	ResourceType    string   `json:"resourceType"`
	ResourceID      string   `json:"resourceId"`
	ResourceAuthor  string   `json:"resourceAuthor"`
	ResourceVersion string   `json:"resourceVersion"`
	Name            string   `json:"name"`
	Summary         string   `json:"summary"`
	Tags            []string `json:"tags"`
	CoverURL        *string  `json:"coverUrl"`
	CoverThumbURL   *string  `json:"coverThumbUrl"`
	DownloadCount   int      `json:"downloadCount"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
	Uploader        struct {
		DisplayName string `json:"displayName"`
	} `json:"uploader"`
}

func writePackageForm(t *testing.T, mw *multipart.Writer, zipBytes []byte, options uploadOptions) {
	t.Helper()
	if zipBytes != nil {
		field, err := mw.CreateFormFile("file", "test.zip")
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		if _, err := field.Write(zipBytes); err != nil {
			t.Fatalf("write zip to form: %v", err)
		}
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
}

// uploadPackage POSTs a multipart upload to the market packages endpoint.
func uploadPackage(t *testing.T, client *http.Client, url string, zipBytes []byte, options uploadOptions) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	writePackageForm(t, mw, zipBytes, options)
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

func updatePackage(t *testing.T, client *http.Client, url string, zipBytes []byte, options uploadOptions) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	writePackageForm(t, mw, zipBytes, options)
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req, err := http.NewRequest(http.MethodPatch, url, &buf)
	if err != nil {
		t.Fatalf("create update request: %v", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("update request: %v", err)
	}
	return res
}

func mustUploadPackage(t *testing.T, client *http.Client, baseURL string, zipBytes []byte, options uploadOptions) packageBody {
	t.Helper()
	resp := uploadPackage(t, client, baseURL+"/api/v1/market/packages", zipBytes, options)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("upload status = %d, body: %s", resp.StatusCode, body)
	}
	var pkg packageBody
	if err := json.NewDecoder(resp.Body).Decode(&pkg); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}
	return pkg
}

func TestMarketUploadNormalizesCoverToWebP(t *testing.T) {
	t.Parallel()

	server, client := newMarketTestServer(t)
	loginMockUser(t, client, server.URL)

	uploadResp := uploadPackage(t, client, server.URL+"/api/v1/market/packages", buildTestPackageZipWithCover(t), uploadOptions{})
	defer uploadResp.Body.Close()
	if uploadResp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(uploadResp.Body)
		t.Fatalf("upload status = %d, body: %s", uploadResp.StatusCode, body)
	}
	var pkg struct {
		ID            string  `json:"id"`
		CoverURL      *string `json:"coverUrl"`
		CoverThumbURL *string `json:"coverThumbUrl"`
	}
	if err := json.NewDecoder(uploadResp.Body).Decode(&pkg); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}
	if pkg.CoverURL == nil || pkg.CoverThumbURL == nil {
		t.Fatalf("cover urls = %v / %v, want both present", pkg.CoverURL, pkg.CoverThumbURL)
	}

	coverResp, err := client.Get(server.URL + *pkg.CoverURL)
	if err != nil {
		t.Fatalf("GET cover: %v", err)
	}
	defer coverResp.Body.Close()
	if coverResp.Header.Get("Content-Type") != "image/webp" {
		t.Fatalf("cover content-type = %q", coverResp.Header.Get("Content-Type"))
	}
	coverBytes, err := io.ReadAll(coverResp.Body)
	if err != nil {
		t.Fatalf("read cover: %v", err)
	}
	if len(coverBytes) == 0 {
		t.Fatalf("cover body is empty")
	}

	thumbResp, err := client.Get(server.URL + *pkg.CoverThumbURL)
	if err != nil {
		t.Fatalf("GET cover thumb: %v", err)
	}
	defer thumbResp.Body.Close()
	if thumbResp.Header.Get("Content-Type") != "image/webp" {
		t.Fatalf("thumb content-type = %q", thumbResp.Header.Get("Content-Type"))
	}

	downloadResp, err := client.Get(server.URL + "/api/v1/market/packages/" + pkg.ID + "/download")
	if err != nil {
		t.Fatalf("download package: %v", err)
	}
	defer downloadResp.Body.Close()
	downloadedBytes, err := io.ReadAll(downloadResp.Body)
	if err != nil {
		t.Fatalf("read downloaded package: %v", err)
	}
	entries := unzipEntries(t, downloadedBytes)
	if _, ok := entries["cover/cover.webp"]; !ok {
		t.Fatalf("downloaded package missing cover/cover.webp; entries: %v", mapKeys(entries))
	}
	if _, ok := entries["cover/cover.png"]; ok {
		t.Fatalf("downloaded package kept original cover/cover.png")
	}
	var manifest struct {
		Manifest struct {
			Cover struct {
				WorkspacePath string `json:"workspacePath"`
				Alt           string `json:"alt"`
			} `json:"cover"`
		} `json:"manifest"`
		CoverFiles []struct {
			Path      string `json:"path"`
			MediaType string `json:"mediaType"`
		} `json:"coverFiles"`
	}
	if err := json.Unmarshal(entries["game-card.json"], &manifest); err != nil {
		t.Fatalf("parse downloaded manifest: %v", err)
	}
	if manifest.Manifest.Cover.WorkspacePath != ".cover/cover.webp" || manifest.Manifest.Cover.Alt != "Test Cover" {
		t.Fatalf("manifest cover = %+v", manifest.Manifest.Cover)
	}
	if len(manifest.CoverFiles) != 1 || manifest.CoverFiles[0].Path != "cover/cover.webp" || manifest.CoverFiles[0].MediaType != "image/webp" {
		t.Fatalf("manifest coverFiles = %+v", manifest.CoverFiles)
	}
}

func TestMarketCountsAndCursorPagination(t *testing.T) {
	t.Parallel()

	server, client := newMarketTestServer(t)
	loginMockUser(t, client, server.URL)

	for i := 0; i < 3; i++ {
		resp := uploadPackage(t, client, server.URL+"/api/v1/market/packages", buildTestPackageZip(t), uploadOptions{Title: fmt.Sprintf("Card %d", i)})
		resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("card upload %d status = %d", i, resp.StatusCode)
		}
	}
	agentZip := buildResourcePackageZip(t,
		`{"schema":"tsian.resource.package.v1","resourceType":"agent","resourceId":"agent-paged","name":"Paged Agent","summary":"Runs things.","author":"Author","version":"1.0.0","files":[{"path":"agent.json"},{"path":"AGENT.md"}]}`,
		map[string][]byte{"agent.json": []byte(`{"id":"agent-paged"}`), "AGENT.md": []byte("# Paged Agent\n")},
	)
	resp := uploadPackage(t, client, server.URL+"/api/v1/market/packages", agentZip, uploadOptions{ResourceType: "agent"})
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("agent upload status = %d", resp.StatusCode)
	}
	toolZip := buildResourcePackageZip(t,
		`{"schema":"tsian.resource.package.v1","resourceType":"tool","resourceId":"tool-paged","name":"Paged Tool","summary":"Runs tools.","author":"Author","version":"1.0.0","files":[{"path":"tool.json"},{"path":"run.js"}]}`,
		map[string][]byte{
			"tool.json": []byte(`{"name":"tool_paged","title":"Paged Tool","description":"Runs tools.","parameters":{"type":"object"},"executor":{"type":"browser_script","path":"./run.js"}}`),
			"run.js":    []byte("return { ok: true }\n"),
		},
	)
	resp = uploadPackage(t, client, server.URL+"/api/v1/market/packages", toolZip, uploadOptions{ResourceType: "tool"})
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("tool upload status = %d", resp.StatusCode)
	}

	countsResp, err := client.Get(server.URL + "/api/v1/market/packages/counts")
	if err != nil {
		t.Fatalf("counts request: %v", err)
	}
	defer countsResp.Body.Close()
	var countsBody struct {
		Counts map[string]int `json:"counts"`
	}
	if err := json.NewDecoder(countsResp.Body).Decode(&countsBody); err != nil {
		t.Fatalf("decode counts: %v", err)
	}
	if countsBody.Counts["game_card"] != 3 || countsBody.Counts["agent"] != 1 || countsBody.Counts["skill"] != 0 || countsBody.Counts["tool"] != 1 {
		t.Fatalf("counts = %+v", countsBody.Counts)
	}

	firstResp, err := client.Get(server.URL + "/api/v1/market/packages?resourceType=game_card&limit=2")
	if err != nil {
		t.Fatalf("first page request: %v", err)
	}
	defer firstResp.Body.Close()
	var firstPage struct {
		Packages []struct {
			ID string `json:"id"`
		} `json:"packages"`
		NextCursor *string `json:"nextCursor"`
	}
	if err := json.NewDecoder(firstResp.Body).Decode(&firstPage); err != nil {
		t.Fatalf("decode first page: %v", err)
	}
	if len(firstPage.Packages) != 2 || firstPage.NextCursor == nil {
		t.Fatalf("first page = %+v", firstPage)
	}

	secondResp, err := client.Get(server.URL + "/api/v1/market/packages?resourceType=game_card&limit=2&cursor=" + *firstPage.NextCursor)
	if err != nil {
		t.Fatalf("second page request: %v", err)
	}
	defer secondResp.Body.Close()
	var secondPage struct {
		Packages []struct {
			ID string `json:"id"`
		} `json:"packages"`
		NextCursor *string `json:"nextCursor"`
	}
	if err := json.NewDecoder(secondResp.Body).Decode(&secondPage); err != nil {
		t.Fatalf("decode second page: %v", err)
	}
	if len(secondPage.Packages) != 1 || secondPage.NextCursor != nil {
		t.Fatalf("second page = %+v", secondPage)
	}
	if secondPage.Packages[0].ID == firstPage.Packages[0].ID || secondPage.Packages[0].ID == firstPage.Packages[1].ID {
		t.Fatalf("pagination duplicated package id %s", secondPage.Packages[0].ID)
	}
}

func unzipEntries(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	entries := map[string][]byte{}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open zip entry %s: %v", f.Name, err)
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read zip entry %s: %v", f.Name, err)
		}
		entries[f.Name] = content
	}
	return entries
}

func mapKeys(values map[string][]byte) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}

func TestMarketSearch(t *testing.T) {
	t.Parallel()

	server, client := newMarketTestServer(t)
	loginMockUser(t, client, server.URL)

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
	loginMockUser(t, client, server.URL)

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

	toolZip := buildResourcePackageZip(t,
		`{"schema":"tsian.resource.package.v1","resourceType":"tool","resourceId":"roll-dice","name":"Roll Dice","summary":"Rolls dice directly.","author":"Author C","version":"0.4.0","files":[{"path":"tool.json","mediaType":"application/json"},{"path":"run.js","mediaType":"text/javascript"}]}`,
		map[string][]byte{
			"tool.json": []byte(`{"name":"roll_dice","title":"Roll Dice","description":"Rolls dice directly.","parameters":{"type":"object","properties":{"sides":{"type":"number"}}},"executor":{"type":"browser_script","path":"./run.js"}}`),
			"run.js":    []byte("return { rolls: [1], total: 1 }\n"),
		},
	)
	toolResp := uploadPackage(t, client, server.URL+"/api/v1/market/packages", toolZip, uploadOptions{ResourceType: "tool", Tags: "dice, utility"})
	defer toolResp.Body.Close()
	if toolResp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(toolResp.Body)
		t.Fatalf("tool upload status = %d, body: %s", toolResp.StatusCode, body)
	}
	var toolPkg struct {
		ID              string   `json:"id"`
		ResourceType    string   `json:"resourceType"`
		ResourceID      string   `json:"resourceId"`
		ResourceAuthor  string   `json:"resourceAuthor"`
		ResourceVersion string   `json:"resourceVersion"`
		Tags            []string `json:"tags"`
	}
	if err := json.NewDecoder(toolResp.Body).Decode(&toolPkg); err != nil {
		t.Fatalf("decode tool upload: %v", err)
	}
	if toolPkg.ResourceType != "tool" || toolPkg.ResourceID != "roll-dice" || toolPkg.ResourceAuthor != "Author C" || toolPkg.ResourceVersion != "0.4.0" {
		t.Fatalf("tool package = %+v", toolPkg)
	}
	if !stringSlicesEqual(toolPkg.Tags, []string{"dice", "utility"}) {
		t.Fatalf("tool tags = %+v", toolPkg.Tags)
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

	toolListResp, err := client.Get(server.URL + "/api/v1/market/packages?resourceType=tool")
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	defer toolListResp.Body.Close()
	if err := json.NewDecoder(toolListResp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode tool list: %v", err)
	}
	if len(listBody.Packages) != 1 || listBody.Packages[0].ResourceType != "tool" || listBody.Packages[0].ResourceID != "roll-dice" {
		t.Fatalf("tool list = %+v", listBody.Packages)
	}

	toolDownloadResp, err := client.Get(server.URL + "/api/v1/market/packages/" + toolPkg.ID + "/download")
	if err != nil {
		t.Fatalf("download tool: %v", err)
	}
	defer toolDownloadResp.Body.Close()
	if got := toolDownloadResp.Header.Get("Content-Disposition"); got != `attachment; filename="roll-dice.tsian-tool.zip"` {
		t.Fatalf("tool download disposition = %q", got)
	}
	toolDownloadedBytes, err := io.ReadAll(toolDownloadResp.Body)
	if err != nil {
		t.Fatalf("read tool download: %v", err)
	}
	if !bytes.Equal(toolDownloadedBytes, toolZip) {
		t.Fatalf("tool download content mismatch")
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

func TestMarketContentManagementUpdateAndOwnership(t *testing.T) {
	t.Parallel()

	server, ownerClient, db := newMarketTestServerWithDB(t)
	loginTestUser(t, db, ownerClient, server.URL, "owner", "Owner Player")

	ownerPkg := mustUploadPackage(t, ownerClient, server.URL,
		buildGameCardPackageZip(t, "owned-card", "Owned Card", "1.0.0", "Original summary."),
		uploadOptions{Tags: "mine"},
	)

	otherClient := newMarketHTTPClient(t, server)
	loginTestUser(t, db, otherClient, server.URL, "other", "Other Player")
	otherPkg := mustUploadPackage(t, otherClient, server.URL,
		buildGameCardPackageZip(t, "other-card", "Other Card", "1.0.0", "Other summary."),
		uploadOptions{},
	)

	myListResp, err := ownerClient.Get(server.URL + "/api/v1/market/my/packages")
	if err != nil {
		t.Fatalf("my list request: %v", err)
	}
	defer myListResp.Body.Close()
	var myList struct {
		Packages []packageBody `json:"packages"`
	}
	if err := json.NewDecoder(myListResp.Body).Decode(&myList); err != nil {
		t.Fatalf("decode my list: %v", err)
	}
	if len(myList.Packages) != 1 || myList.Packages[0].ID != ownerPkg.ID {
		t.Fatalf("my list = %+v, want only %s", myList.Packages, ownerPkg.ID)
	}

	countsResp, err := ownerClient.Get(server.URL + "/api/v1/market/my/packages/counts")
	if err != nil {
		t.Fatalf("my counts request: %v", err)
	}
	defer countsResp.Body.Close()
	var countsBody struct {
		Counts map[string]int `json:"counts"`
	}
	if err := json.NewDecoder(countsResp.Body).Decode(&countsBody); err != nil {
		t.Fatalf("decode my counts: %v", err)
	}
	if countsBody.Counts["game_card"] != 1 || countsBody.Counts["agent"] != 0 || countsBody.Counts["skill"] != 0 || countsBody.Counts["tool"] != 0 {
		t.Fatalf("my counts = %+v", countsBody.Counts)
	}

	patchURL := server.URL + "/api/v1/market/packages/" + ownerPkg.ID
	unauthResp := updatePackage(t, &http.Client{}, patchURL, nil, uploadOptions{Title: "Nope", Summary: "Nope"})
	defer unauthResp.Body.Close()
	if unauthResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauth update status = %d, want %d", unauthResp.StatusCode, http.StatusUnauthorized)
	}

	nonOwnerResp := updatePackage(t, otherClient, patchURL, nil, uploadOptions{Title: "Stolen", Summary: "Nope"})
	defer nonOwnerResp.Body.Close()
	if nonOwnerResp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-owner update status = %d, want %d", nonOwnerResp.StatusCode, http.StatusForbidden)
	}

	metadataResp := updatePackage(t, ownerClient, patchURL, nil, uploadOptions{
		Title:   "Retitled Card",
		Summary: "Updated summary.",
		Author:  "Owner Author",
		Version: "1.0.1",
		Tags:    "updated, mine",
	})
	defer metadataResp.Body.Close()
	if metadataResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(metadataResp.Body)
		t.Fatalf("metadata update status = %d, body: %s", metadataResp.StatusCode, body)
	}
	var metadataPkg packageBody
	if err := json.NewDecoder(metadataResp.Body).Decode(&metadataPkg); err != nil {
		t.Fatalf("decode metadata update: %v", err)
	}
	if metadataPkg.ResourceID != "owned-card" || metadataPkg.Name != "Retitled Card" || metadataPkg.Summary != "Updated summary." || metadataPkg.ResourceAuthor != "Owner Author" || metadataPkg.ResourceVersion != "1.0.1" {
		t.Fatalf("metadata update package = %+v", metadataPkg)
	}
	if !stringSlicesEqual(metadataPkg.Tags, []string{"updated", "mine"}) {
		t.Fatalf("metadata tags = %+v", metadataPkg.Tags)
	}
	if metadataPkg.UpdatedAt == "" {
		t.Fatalf("updatedAt is empty after metadata update")
	}

	wrongTypeZip := buildResourcePackageZip(t,
		`{"schema":"tsian.resource.package.v1","resourceType":"agent","resourceId":"wrong-kind","name":"Wrong Kind","summary":"Wrong kind.","author":"Author","version":"1.0.0","files":[{"path":"agent.json"},{"path":"AGENT.md"}]}`,
		map[string][]byte{"agent.json": []byte(`{"id":"wrong-kind"}`), "AGENT.md": []byte("# Wrong Kind\n")},
	)
	wrongTypeResp := updatePackage(t, ownerClient, patchURL, wrongTypeZip, uploadOptions{})
	defer wrongTypeResp.Body.Close()
	if wrongTypeResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("wrong-type replacement status = %d, want %d", wrongTypeResp.StatusCode, http.StatusBadRequest)
	}

	replacementZip := buildGameCardPackageZip(t, "replacement-card", "Replacement Card", "2.0.0", "Replacement summary.")
	replaceResp := updatePackage(t, ownerClient, patchURL, replacementZip, uploadOptions{Tags: "replacement"})
	defer replaceResp.Body.Close()
	if replaceResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(replaceResp.Body)
		t.Fatalf("replacement update status = %d, body: %s", replaceResp.StatusCode, body)
	}
	var replacedPkg packageBody
	if err := json.NewDecoder(replaceResp.Body).Decode(&replacedPkg); err != nil {
		t.Fatalf("decode replacement update: %v", err)
	}
	if replacedPkg.ID != ownerPkg.ID || replacedPkg.ResourceID != "replacement-card" || replacedPkg.Name != "Replacement Card" || replacedPkg.ResourceVersion != "2.0.0" {
		t.Fatalf("replacement package = %+v", replacedPkg)
	}
	if !stringSlicesEqual(replacedPkg.Tags, []string{"replacement"}) {
		t.Fatalf("replacement tags = %+v", replacedPkg.Tags)
	}
	downloadResp, err := ownerClient.Get(server.URL + "/api/v1/market/packages/" + ownerPkg.ID + "/download")
	if err != nil {
		t.Fatalf("download replacement: %v", err)
	}
	defer downloadResp.Body.Close()
	downloadedBytes, err := io.ReadAll(downloadResp.Body)
	if err != nil {
		t.Fatalf("read replacement download: %v", err)
	}
	if !bytes.Equal(downloadedBytes, replacementZip) {
		t.Fatalf("downloaded replacement does not match uploaded replacement")
	}

	nonOwnerDeleteReq, err := http.NewRequest(http.MethodDelete, patchURL, nil)
	if err != nil {
		t.Fatalf("create non-owner delete request: %v", err)
	}
	nonOwnerDeleteResp, err := otherClient.Do(nonOwnerDeleteReq)
	if err != nil {
		t.Fatalf("non-owner delete request: %v", err)
	}
	defer nonOwnerDeleteResp.Body.Close()
	if nonOwnerDeleteResp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-owner delete status = %d, want %d", nonOwnerDeleteResp.StatusCode, http.StatusForbidden)
	}

	deleteReq, err := http.NewRequest(http.MethodDelete, patchURL, nil)
	if err != nil {
		t.Fatalf("create delete request: %v", err)
	}
	deleteResp, err := ownerClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("delete request: %v", err)
	}
	deleteResp.Body.Close()
	if deleteResp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d, want %d", deleteResp.StatusCode, http.StatusNoContent)
	}

	assertStatus(t, ownerClient, http.MethodGet, patchURL, http.StatusNotFound)
	assertStatus(t, ownerClient, http.MethodGet, patchURL+"/download", http.StatusNotFound)
	assertStatus(t, ownerClient, http.MethodGet, server.URL+"/api/v1/market/packages/"+otherPkg.ID, http.StatusOK)
}

func TestMarketDeleteRemovesCoverEndpoints(t *testing.T) {
	t.Parallel()

	server, client := newMarketTestServer(t)
	loginMockUser(t, client, server.URL)
	pkg := mustUploadPackage(t, client, server.URL, buildTestPackageZipWithCover(t), uploadOptions{})
	if pkg.CoverURL == nil || pkg.CoverThumbURL == nil {
		t.Fatalf("expected cover urls, got %v / %v", pkg.CoverURL, pkg.CoverThumbURL)
	}
	assertStatus(t, client, http.MethodGet, server.URL+*pkg.CoverURL, http.StatusOK)
	assertStatus(t, client, http.MethodGet, server.URL+*pkg.CoverThumbURL, http.StatusOK)

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/api/v1/market/packages/"+pkg.ID, nil)
	if err != nil {
		t.Fatalf("create delete request: %v", err)
	}
	deleteResp, err := client.Do(deleteReq)
	if err != nil {
		t.Fatalf("delete request: %v", err)
	}
	deleteResp.Body.Close()
	if deleteResp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d, want %d", deleteResp.StatusCode, http.StatusNoContent)
	}

	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/market/packages/"+pkg.ID, http.StatusNotFound)
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/market/packages/"+pkg.ID+"/download", http.StatusNotFound)
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/market/packages/"+pkg.ID+"/cover", http.StatusNotFound)
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/market/packages/"+pkg.ID+"/cover-thumb", http.StatusNotFound)
}

func TestMarketResourcePackageValidation(t *testing.T) {
	t.Parallel()

	server, client := newMarketTestServer(t)
	loginMockUser(t, client, server.URL)

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
			name:         "tool missing tool.json",
			resourceType: "tool",
			zipBytes: buildResourcePackageZip(t,
				`{"schema":"tsian.resource.package.v1","resourceType":"tool","resourceId":"tool-a","name":"Tool A","summary":"Tool summary.","author":"Author","version":"1.0.0","files":[{"path":"run.js"}]}`,
				map[string][]byte{"run.js": []byte("return {}\n")},
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
