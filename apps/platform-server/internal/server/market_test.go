package server

import (
	"archive/zip"
	"bytes"
	"context"
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
)

// buildTestPackageZip builds a minimal valid .tsian-card.zip in memory.
// game-card.json stores a GameCardPackageManifest (package schema wrapping
// an inner GameCardManifest), matching what the frontend exports.
func buildTestPackageZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)

	manifest := `{"schema":"tsian.game-card.package.v1","manifest":{"schema":"tsian.game-card.v1","id":"test-card-001","name":"Test Card","version":"0.1.0","summary":"A test game card for integration tests."}}`
	if err := writeZipFile(w, "game-card.json", manifest); err != nil {
		t.Fatalf("write manifest into zip: %v", err)
	}
	if err := writeZipFile(w, "workspace/README.md", "# Test Card\n"); err != nil {
		t.Fatalf("write workspace file into zip: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

func writeZipFile(w *zip.Writer, name, content string) error {
	f, err := w.Create(name)
	if err != nil {
		return err
	}
	_, err = f.Write([]byte(content))
	return err
}

func TestMarketUploadListDownload(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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
	uploadResp := uploadPackage(t, noAuthClient, server.URL+"/api/v1/market/packages", zipBytes, "", "")
	defer uploadResp.Body.Close()
	if uploadResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("upload without auth status = %d, want %d", uploadResp.StatusCode, http.StatusUnauthorized)
	}

	// Upload with auth.
	uploadResp = uploadPackage(t, client, server.URL+"/api/v1/market/packages", zipBytes, "", "")
	defer uploadResp.Body.Close()
	if uploadResp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(uploadResp.Body)
		t.Fatalf("upload with auth status = %d, want %d, body: %s", uploadResp.StatusCode, http.StatusCreated, body)
	}
	var pkg struct {
		ID            string `json:"id"`
		CardID        string `json:"cardId"`
		Name          string `json:"name"`
		Summary       string `json:"summary"`
		DownloadCount int    `json:"downloadCount"`
		Uploader      struct {
			DisplayName string `json:"displayName"`
		} `json:"uploader"`
	}
	if err := json.NewDecoder(uploadResp.Body).Decode(&pkg); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}
	if pkg.CardID != "test-card-001" || pkg.Name != "Test Card" {
		t.Fatalf("uploaded package = %+v", pkg)
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

// uploadPackage POSTs a multipart upload to the market packages endpoint.
func uploadPackage(t *testing.T, client *http.Client, url string, zipBytes []byte, title, summary string) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	field, err := mw.CreateFormFile("file", "test.tsian-card.zip")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := field.Write(zipBytes); err != nil {
		t.Fatalf("write zip to form: %v", err)
	}
	if title != "" {
		_ = mw.WriteField("title", title)
	}
	if summary != "" {
		_ = mw.WriteField("summary", summary)
	}
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

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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
	assertStatus(t, client, http.MethodGet, server.URL+"/api/v1/auth/mock-login", http.StatusFound)

	// Upload a package with a distinctive name.
	zipBytes := buildTestPackageZip(t)
	uploadResp := uploadPackage(t, client, server.URL+"/api/v1/market/packages", zipBytes, "Custom Title", "Custom summary text")
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
