package storage

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func OpenSQLite(ctx context.Context, dbPath string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("create sqlite directory: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)

	if err := migrate(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func migrate(ctx context.Context, db *sql.DB) error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			handle TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL,
			avatar_url TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS auth_identities (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			provider TEXT NOT NULL,
			subject TEXT NOT NULL,
			credential_hash TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE(provider, subject)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
		`CREATE TABLE IF NOT EXISTS market_packages (
					id TEXT PRIMARY KEY,
					resource_type TEXT NOT NULL DEFAULT 'game_card',
					card_id TEXT NOT NULL,
					card_author TEXT NOT NULL DEFAULT '',
					card_version TEXT NOT NULL DEFAULT '',
					resource_id TEXT NOT NULL DEFAULT '',
					resource_author TEXT NOT NULL DEFAULT '',
					resource_version TEXT NOT NULL DEFAULT '',
					name TEXT NOT NULL,
					summary TEXT NOT NULL,
					tags TEXT NOT NULL DEFAULT '[]',
					cover_blob_key TEXT,
					cover_thumb_blob_key TEXT,
					uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
					download_count INTEGER NOT NULL DEFAULT 0,
					hidden_at TEXT,
					hidden_by TEXT REFERENCES users(id) ON DELETE SET NULL,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL
				)`,
		`CREATE INDEX IF NOT EXISTS idx_market_packages_created ON market_packages(created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_market_packages_downloads ON market_packages(download_count DESC)`,
		`CREATE TABLE IF NOT EXISTS announcements (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				body TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
		`CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS presence_sessions (
				id TEXT PRIMARY KEY,
				user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
				last_seen_at TEXT NOT NULL,
				created_at TEXT NOT NULL
			)`,
		`CREATE INDEX IF NOT EXISTS idx_presence_sessions_last_seen ON presence_sessions(last_seen_at)`,
		`CREATE INDEX IF NOT EXISTS idx_presence_sessions_user ON presence_sessions(user_id)`,
		`CREATE TABLE IF NOT EXISTS cloud_backups (
				id TEXT PRIMARY KEY,
				owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				card_id TEXT NOT NULL,
				card_version TEXT NOT NULL,
				revision_id TEXT NOT NULL,
				manifest_json TEXT NOT NULL,
				size_bytes INTEGER NOT NULL,
				file_count INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
		`CREATE INDEX IF NOT EXISTS idx_cloud_backups_owner_updated ON cloud_backups(owner_user_id, updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_cloud_backups_owner_card_updated ON cloud_backups(owner_user_id, card_id, updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS cloud_backup_blobs (
				owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				hash TEXT NOT NULL,
				size_bytes INTEGER NOT NULL,
				media_type TEXT NOT NULL,
				storage_key TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY(owner_user_id, hash)
			)`,
		`CREATE INDEX IF NOT EXISTS idx_cloud_backup_blobs_owner ON cloud_backup_blobs(owner_user_id)`,
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("migrate sqlite: %w", err)
		}
	}
	if err := ensureMarketPackageColumns(ctx, db); err != nil {
		return fmt.Errorf("migrate market packages: %w", err)
	}
	if _, err := db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_market_packages_hidden ON market_packages(hidden_at)`); err != nil {
		return fmt.Errorf("create market hidden index: %w", err)
	}
	return nil
}

func ensureMarketPackageColumns(ctx context.Context, db *sql.DB) error {
	columns, err := tableColumns(ctx, db, "market_packages")
	if err != nil {
		return err
	}

	addColumn := func(name, definition string) error {
		if columns[name] {
			return nil
		}
		if _, err := db.ExecContext(ctx, `ALTER TABLE market_packages ADD COLUMN `+definition); err != nil {
			return fmt.Errorf("add market_packages.%s: %w", name, err)
		}
		columns[name] = true
		return nil
	}

	if err := addColumn("resource_id", "resource_id TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := addColumn("resource_author", "resource_author TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := addColumn("resource_version", "resource_version TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := addColumn("tags", "tags TEXT NOT NULL DEFAULT '[]'"); err != nil {
		return err
	}
	if err := addColumn("cover_thumb_blob_key", "cover_thumb_blob_key TEXT"); err != nil {
		return err
	}
	if err := addColumn("hidden_at", "hidden_at TEXT"); err != nil {
		return err
	}
	if err := addColumn("hidden_by", "hidden_by TEXT REFERENCES users(id) ON DELETE SET NULL"); err != nil {
		return err
	}

	_, err = db.ExecContext(ctx, `UPDATE market_packages
		SET resource_id = CASE WHEN resource_id = '' THEN card_id ELSE resource_id END,
			resource_author = CASE WHEN resource_author = '' THEN card_author ELSE resource_author END,
			resource_version = CASE WHEN resource_version = '' THEN card_version ELSE resource_version END,
			tags = CASE WHEN tags = '' THEN '[]' ELSE tags END`)
	if err != nil {
		return fmt.Errorf("backfill market package resource columns: %w", err)
	}
	return nil
}

func tableColumns(ctx context.Context, db *sql.DB, tableName string) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx, `PRAGMA table_info(`+tableName+`)`)
	if err != nil {
		return nil, fmt.Errorf("inspect table %s: %w", tableName, err)
	}
	defer rows.Close()

	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var name string
		var dataType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return nil, fmt.Errorf("scan table %s columns: %w", tableName, err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate table %s columns: %w", tableName, err)
	}
	return columns, nil
}
