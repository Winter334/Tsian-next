package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"tsian/platform-server/internal/config"
	"tsian/platform-server/internal/server"
	"tsian/platform-server/internal/storage"
)

func main() {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := storage.OpenSQLite(ctx, cfg.DBPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	srv := server.New(cfg, db)
	log.Printf("platform-server listening on %s", cfg.Addr)
	if err := http.ListenAndServe(cfg.Addr, srv.Handler()); err != nil {
		log.Fatal(err)
	}
}
