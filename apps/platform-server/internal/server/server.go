package server

import (
	"database/sql"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"tsian/platform-server/internal/admin"
	"tsian/platform-server/internal/announcement"
	"tsian/platform-server/internal/auth"
	"tsian/platform-server/internal/config"
	"tsian/platform-server/internal/market"
	"tsian/platform-server/internal/middleware"
	"tsian/platform-server/internal/presence"
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
	adminAuthorizer := admin.NewAuthorizer(s.cfg)
	adminOnly := func(handler http.HandlerFunc) http.Handler {
		return middleware.RequireAdmin(s.db, users, adminAuthorizer, handler)
	}

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	mux.HandleFunc("GET /api/v1/auth/login", authHandler.HandleLogin)
	mux.HandleFunc("GET /api/v1/auth/callback", authHandler.HandleCallback)
	mux.Handle("GET /api/v1/auth/me", middleware.RequireAuth(s.db, users, http.HandlerFunc(authHandler.HandleMe)))
	mux.HandleFunc("POST /api/v1/auth/logout", authHandler.HandleLogout)
	mux.Handle("GET /api/v1/admin/me", adminOnly(http.HandlerFunc(authHandler.HandleAdminMe)))
	if s.cfg.MockAuth {
		mux.HandleFunc("GET /api/v1/auth/mock-login", authHandler.HandleMockLogin)
	}

	// Market / Workshop
	blobStore := &storage.FileSystemBlobStore{Root: s.cfg.DataDir}
	marketRepo := market.NewSQLiteRepository(s.db)
	marketHandler := market.NewHandler(marketRepo, blobStore)
	mux.HandleFunc("GET /api/v1/market/packages", marketHandler.HandleList)
	mux.Handle("GET /api/v1/market/my/packages", middleware.RequireAuth(s.db, users, http.HandlerFunc(marketHandler.HandleListMine)))
	mux.HandleFunc("GET /api/v1/market/packages/counts", marketHandler.HandleCounts)
	mux.Handle("GET /api/v1/market/my/packages/counts", middleware.RequireAuth(s.db, users, http.HandlerFunc(marketHandler.HandleCountsMine)))
	mux.HandleFunc("GET /api/v1/market/packages/{id}", marketHandler.HandleGet)
	mux.Handle("POST /api/v1/market/packages", middleware.RequireAuth(s.db, users, http.HandlerFunc(marketHandler.HandleUpload)))
	mux.Handle("PATCH /api/v1/market/packages/{id}", middleware.RequireAuth(s.db, users, http.HandlerFunc(marketHandler.HandleUpdate)))
	mux.Handle("DELETE /api/v1/market/packages/{id}", middleware.RequireAuth(s.db, users, http.HandlerFunc(marketHandler.HandleDelete)))
	mux.HandleFunc("GET /api/v1/market/packages/{id}/download", marketHandler.HandleDownload)
	mux.HandleFunc("GET /api/v1/market/packages/{id}/cover", marketHandler.HandleCover)
	mux.HandleFunc("GET /api/v1/market/packages/{id}/cover-thumb", marketHandler.HandleCoverThumb)

	announcementRepo := announcement.NewSQLiteRepository(s.db)
	announcementHandler := announcement.NewHandler(announcementRepo)
	mux.HandleFunc("GET /api/v1/announcements", announcementHandler.HandleList)
	mux.Handle("GET /api/v1/admin/announcements", adminOnly(http.HandlerFunc(announcementHandler.HandleList)))
	mux.Handle("POST /api/v1/admin/announcements", adminOnly(http.HandlerFunc(announcementHandler.HandleCreate)))
	mux.Handle("PATCH /api/v1/admin/announcements/{id}", adminOnly(http.HandlerFunc(announcementHandler.HandleUpdate)))
	mux.Handle("DELETE /api/v1/admin/announcements/{id}", adminOnly(http.HandlerFunc(announcementHandler.HandleDelete)))

	presenceRepo := presence.NewSQLiteRepository(s.db)
	presenceHandler := presence.NewHandler(presenceRepo, s.db, users, s.cfg.CookieSecure)
	mux.HandleFunc("POST /api/v1/presence/heartbeat", presenceHandler.HandleHeartbeat)
	mux.HandleFunc("GET /api/v1/presence/summary", presenceHandler.HandleSummary)

	mux.Handle("GET /api/v1/admin/market/packages", adminOnly(http.HandlerFunc(marketHandler.HandleAdminList)))
	mux.Handle("GET /api/v1/admin/market/packages/{id}", adminOnly(http.HandlerFunc(marketHandler.HandleAdminGet)))
	mux.Handle("PATCH /api/v1/admin/market/packages/{id}", adminOnly(http.HandlerFunc(marketHandler.HandleAdminUpdate)))
	mux.Handle("POST /api/v1/admin/market/packages/{id}/hide", adminOnly(http.HandlerFunc(marketHandler.HandleAdminHide)))
	mux.Handle("POST /api/v1/admin/market/packages/{id}/unhide", adminOnly(http.HandlerFunc(marketHandler.HandleAdminUnhide)))
	mux.Handle("DELETE /api/v1/admin/market/packages/{id}", adminOnly(http.HandlerFunc(marketHandler.HandleAdminDelete)))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	mux.HandleFunc("GET /admin", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusFound)
	})
	mux.Handle("/admin/", spaHandler{staticDir: s.cfg.AdminStaticDir, urlPrefix: "/admin"})
	mux.Handle("/", spaHandler{staticDir: s.cfg.StaticDir})

	return middleware.Log(middleware.Recover(mux))
}

type spaHandler struct {
	staticDir string
	urlPrefix string
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
	if h.urlPrefix != "" {
		prefix := strings.TrimPrefix(path.Clean("/"+h.urlPrefix), "/")
		requestPath = strings.TrimPrefix(requestPath, prefix)
		requestPath = strings.TrimPrefix(requestPath, "/")
	}
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
