package server

import (
	"database/sql"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"tsian/platform-server/internal/auth"
	"tsian/platform-server/internal/config"
	"tsian/platform-server/internal/market"
	"tsian/platform-server/internal/middleware"
	"tsian/platform-server/internal/storage"
	"tsian/platform-server/internal/user"
)

type Server struct {
	cfg config.Config
	db  *sql.DB
}

func New(cfg config.Config, db *sql.DB) *Server {
	return &Server{cfg: cfg, db: db}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	users := user.NewSQLiteRepository(s.db)
	authHandler := auth.NewHandler(s.cfg, s.db, users)

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	mux.HandleFunc("GET /api/v1/auth/login", authHandler.HandleLogin)
	mux.HandleFunc("GET /api/v1/auth/callback", authHandler.HandleCallback)
	mux.Handle("GET /api/v1/auth/me", middleware.RequireAuth(s.db, users, http.HandlerFunc(authHandler.HandleMe)))
	mux.HandleFunc("POST /api/v1/auth/logout", authHandler.HandleLogout)
	if s.cfg.MockAuth {
		mux.HandleFunc("GET /api/v1/auth/mock-login", authHandler.HandleMockLogin)
	}

	// Market / Workshop
	blobStore := &storage.FileSystemBlobStore{Root: s.cfg.DataDir}
	marketRepo := market.NewSQLiteRepository(s.db)
	marketHandler := market.NewHandler(marketRepo, blobStore)
	mux.HandleFunc("GET /api/v1/market/packages", marketHandler.HandleList)
	mux.HandleFunc("GET /api/v1/market/packages/counts", marketHandler.HandleCounts)
	mux.HandleFunc("GET /api/v1/market/packages/{id}", marketHandler.HandleGet)
	mux.Handle("POST /api/v1/market/packages", middleware.RequireAuth(s.db, users, http.HandlerFunc(marketHandler.HandleUpload)))
	mux.HandleFunc("GET /api/v1/market/packages/{id}/download", marketHandler.HandleDownload)
	mux.HandleFunc("GET /api/v1/market/packages/{id}/cover", marketHandler.HandleCover)
	mux.HandleFunc("GET /api/v1/market/packages/{id}/cover-thumb", marketHandler.HandleCoverThumb)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	mux.Handle("/", spaHandler{staticDir: s.cfg.StaticDir})

	return middleware.Log(middleware.Recover(mux))
}

type spaHandler struct {
	staticDir string
}

func (h spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}

	requestPath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if requestPath == "." {
		requestPath = ""
	}
	if requestPath != "" {
		candidate := filepath.Join(h.staticDir, filepath.FromSlash(requestPath))
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			http.ServeFile(w, r, candidate)
			return
		}
	}

	indexPath := filepath.Join(h.staticDir, "index.html")
	if info, err := os.Stat(indexPath); err == nil && !info.IsDir() {
		http.ServeFile(w, r, indexPath)
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("tsian platform-server"))
}
