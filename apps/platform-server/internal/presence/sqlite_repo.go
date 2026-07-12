package presence

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type SQLiteRepository struct {
	db *sql.DB
}

func NewSQLiteRepository(db *sql.DB) *SQLiteRepository {
	return &SQLiteRepository{db: db}
}

func (r *SQLiteRepository) Heartbeat(ctx context.Context, sessionID string, userID *string, now time.Time) error {
	timestamp := now.UTC().Format(time.RFC3339)
	_, err := r.db.ExecContext(ctx, `INSERT INTO presence_sessions (id, user_id, last_seen_at, created_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, last_seen_at = excluded.last_seen_at`,
		sessionID, nullString(userID), timestamp, timestamp)
	if err != nil {
		return fmt.Errorf("upsert presence heartbeat: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) CountActive(ctx context.Context, since time.Time) (int, error) {
	var count int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM presence_sessions WHERE last_seen_at >= ?`, since.UTC().Format(time.RFC3339)).Scan(&count); err != nil {
		return 0, fmt.Errorf("count active presence sessions: %w", err)
	}
	return count, nil
}

func (r *SQLiteRepository) PruneBefore(ctx context.Context, before time.Time) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM presence_sessions WHERE last_seen_at < ?`, before.UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("prune presence sessions: %w", err)
	}
	return nil
}

func nullString(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}
