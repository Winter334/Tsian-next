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
	"os"
	"path/filepath"
	"testing"
	"time"

	"tsian/platform-server/internal/config"
	"tsian/platform-server/internal/storage"
)

type marketSmokeFixture struct {
	server  *httptest.Server
	client  *http.Client
	db      *sql.DB
	blobDir string
}

func newMarketSmokeFixture(t *testing.T) marketSmokeFixture {
	t.Helper()

	root := t.TempDir()
	dbPath := filepath.Join(root, "tsian.db")
	blobDir := filepath.Join(root, "blobs")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	db, err := storage.OpenSQLite(ctx, dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	cfg := config.Config{
		Addr:           ":0",
		BaseURL:        "http://example.test",
		DBPath:         dbPath,
		DataDir:        blobDir,
		StaticDir:      filepath.Join(root, "static"),
		AdminStaticDir: filepath.Join(root, "admin-static"),
		CookieSecure:   false,
		MockAuth:       true,
	}
	server := httptest.NewServer(New(cfg, db).Handler())
	t.Cleanup(server.Close)

	return marketSmokeFixture{
		server:  server,
		client:  newMarketHTTPClient(t, server),
		db:      db,
		blobDir: blobDir,
	}
}

func TestMarketSmoke(t *testing.T) {
	t.Parallel()

	t.Run("unauthenticated upload leaves no persistent state", func(t *testing.T) {
		fixture := newMarketSmokeFixture(t)
		zipBytes := buildTestPackageZip(t)

		resp := uploadPackage(t, fixture.server.Client(), fixture.server.URL+"/api/v1/market/packages", zipBytes)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("unauthenticated upload status = %d, want %d, body: %s", resp.StatusCode, http.StatusUnauthorized, body)
		}

		var packageCount int
		if err := fixture.db.QueryRow(`SELECT COUNT(*) FROM market_packages`).Scan(&packageCount); err != nil {
			t.Fatalf("count market packages after unauthenticated upload: %v", err)
		}
		if packageCount != 0 {
			t.Fatalf("market package count after unauthenticated upload = %d, want 0", packageCount)
		}

		entries, err := os.ReadDir(fixture.blobDir)
		if err != nil && !os.IsNotExist(err) {
			t.Fatalf("read blob directory after unauthenticated upload: %v", err)
		}
		if len(entries) != 0 {
			t.Fatalf("blob directory contains %d entries after unauthenticated upload, want 0", len(entries))
		}
	})

	t.Run("authenticated upload list detail and download round trip", func(t *testing.T) {
		fixture := newMarketSmokeFixture(t)
		loginMockUser(t, fixture.client, fixture.server.URL)
		zipBytes := buildTestPackageZip(t)

		uploadResp := uploadPackage(t, fixture.client, fixture.server.URL+"/api/v1/market/packages", zipBytes)
		defer uploadResp.Body.Close()
		if uploadResp.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(uploadResp.Body)
			t.Fatalf("authenticated upload status = %d, want %d, body: %s", uploadResp.StatusCode, http.StatusCreated, body)
		}
		var uploaded packageBody
		if err := json.NewDecoder(uploadResp.Body).Decode(&uploaded); err != nil {
			t.Fatalf("decode upload response: %v", err)
		}
		if uploaded.ID == "" || uploaded.ResourceType != "game_card" || uploaded.ResourceID != "test-card-001" || uploaded.ResourceVersion != "0.1.0" || uploaded.Name != "Test Card" {
			t.Fatalf("uploaded package = %+v", uploaded)
		}
		if uploaded.Uploader.DisplayName != "Mock Player" {
			t.Fatalf("uploader display name = %q, want %q", uploaded.Uploader.DisplayName, "Mock Player")
		}

		listResp, err := fixture.client.Get(fixture.server.URL + "/api/v1/market/packages")
		if err != nil {
			t.Fatalf("list market packages: %v", err)
		}
		defer listResp.Body.Close()
		if listResp.StatusCode != http.StatusOK {
			t.Fatalf("list status = %d, want %d", listResp.StatusCode, http.StatusOK)
		}
		var listBody struct {
			Packages []packageBody `json:"packages"`
		}
		if err := json.NewDecoder(listResp.Body).Decode(&listBody); err != nil {
			t.Fatalf("decode market list: %v", err)
		}
		if len(listBody.Packages) != 1 || listBody.Packages[0].ID != uploaded.ID {
			t.Fatalf("listed packages = %+v, want uploaded package %q", listBody.Packages, uploaded.ID)
		}

		detailResp, err := fixture.client.Get(fixture.server.URL + "/api/v1/market/packages/" + uploaded.ID)
		if err != nil {
			t.Fatalf("get market package: %v", err)
		}
		defer detailResp.Body.Close()
		if detailResp.StatusCode != http.StatusOK {
			t.Fatalf("detail status = %d, want %d", detailResp.StatusCode, http.StatusOK)
		}
		var detail packageBody
		if err := json.NewDecoder(detailResp.Body).Decode(&detail); err != nil {
			t.Fatalf("decode market package detail: %v", err)
		}
		if detail.ID != uploaded.ID || detail.ResourceID != uploaded.ResourceID || detail.Name != uploaded.Name {
			t.Fatalf("package detail = %+v, want uploaded package %+v", detail, uploaded)
		}

		downloadResp, err := fixture.client.Get(fixture.server.URL + "/api/v1/market/packages/" + uploaded.ID + "/download")
		if err != nil {
			t.Fatalf("download market package: %v", err)
		}
		defer downloadResp.Body.Close()
		if downloadResp.StatusCode != http.StatusOK {
			t.Fatalf("download status = %d, want %d", downloadResp.StatusCode, http.StatusOK)
		}
		downloadedBytes, err := io.ReadAll(downloadResp.Body)
		if err != nil {
			t.Fatalf("read downloaded package: %v", err)
		}
		if !bytes.Equal(downloadedBytes, zipBytes) {
			t.Fatalf("downloaded package differs from upload: got %d bytes, want %d", len(downloadedBytes), len(zipBytes))
		}
	})
}

// buildTestPackageZip builds the minimal valid game-card package used by the smoke.
func buildTestPackageZip(t *testing.T) []byte {
	t.Helper()
	return buildZip(t, map[string][]byte{
		"game-card.json":      []byte(`{"schema":"tsian.game-card.package.v1","manifest":{"schema":"tsian.game-card.v1","id":"test-card-001","name":"Test Card","version":"0.1.0","summary":"A test game card for integration tests."}}`),
		"workspace/README.md": []byte("# Test Card\n"),
	})
}

func buildZip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for path, content := range files {
		entry, err := w.Create(path)
		if err != nil {
			t.Fatalf("create zip file %s: %v", path, err)
		}
		if _, err := entry.Write(content); err != nil {
			t.Fatalf("write zip file %s: %v", path, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

func newMarketHTTPClient(t *testing.T, server *httptest.Server) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("create cookie jar: %v", err)
	}
	client := &http.Client{Transport: server.Client().Transport, Jar: jar}
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return client
}

func loginMockUser(t *testing.T, client *http.Client, serverURL string) {
	t.Helper()
	resp, err := client.Get(serverURL + "/api/v1/auth/mock-login")
	if err != nil {
		t.Fatalf("mock login request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("mock login status = %d, want %d", resp.StatusCode, http.StatusFound)
	}
}

type packageBody struct {
	ID              string `json:"id"`
	ResourceType    string `json:"resourceType"`
	ResourceID      string `json:"resourceId"`
	ResourceVersion string `json:"resourceVersion"`
	Name            string `json:"name"`
	Uploader        struct {
		DisplayName string `json:"displayName"`
	} `json:"uploader"`
}

func writePackageForm(t *testing.T, writer *multipart.Writer, zipBytes []byte) {
	t.Helper()
	field, err := writer.CreateFormFile("file", "test.zip")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := field.Write(zipBytes); err != nil {
		t.Fatalf("write zip to form: %v", err)
	}
}

func uploadPackage(t *testing.T, client *http.Client, endpoint string, zipBytes []byte) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	writePackageForm(t, writer, zipBytes)
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, endpoint, &buf)
	if err != nil {
		t.Fatalf("create upload request: %v", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("upload request: %v", err)
	}
	return resp
}
