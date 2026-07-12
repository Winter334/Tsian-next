package announcement

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"tsian/platform-server/internal/user"
)

type SQLiteRepository struct {
	db *sql.DB
}

func NewSQLiteRepository(db *sql.DB) *SQLiteRepository {
	return &SQLiteRepository{db: db}
}

func (r *SQLiteRepository) List(ctx context.Context, limit int) ([]Announcement, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx, `SELECT id, title, body, created_at, updated_at FROM announcements ORDER BY created_at DESC, id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("query announcements: %w", err)
	}
	defer rows.Close()

	items := make([]Announcement, 0)
	for rows.Next() {
		item, err := scanAnnouncement(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate announcements: %w", err)
	}
	return items, nil
}

func (r *SQLiteRepository) Create(ctx context.Context, input Input) (Announcement, error) {
	id, err := user.NewID()
	if err != nil {
		return Announcement{}, fmt.Errorf("generate announcement id: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = r.db.ExecContext(ctx, `INSERT INTO announcements (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, id, input.Title, input.Body, now, now)
	if err != nil {
		return Announcement{}, fmt.Errorf("insert announcement: %w", err)
	}
	return r.getByID(ctx, id)
}

func (r *SQLiteRepository) Update(ctx context.Context, id string, input Input) (Announcement, error) {
	result, err := r.db.ExecContext(ctx, `UPDATE announcements SET title = ?, body = ?, updated_at = ? WHERE id = ?`, input.Title, input.Body, time.Now().UTC().Format(time.RFC3339), id)
	if err != nil {
		return Announcement{}, fmt.Errorf("update announcement: %w", err)
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return Announcement{}, ErrNotFound
	}
	return r.getByID(ctx, id)
}

func (r *SQLiteRepository) Delete(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM announcements WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete announcement: %w", err)
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SQLiteRepository) getByID(ctx context.Context, id string) (Announcement, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id, title, body, created_at, updated_at FROM announcements WHERE id = ?`, id)
	item, err := scanAnnouncementRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Announcement{}, ErrNotFound
	}
	if err != nil {
		return Announcement{}, err
	}
	return item, nil
}

func scanAnnouncement(rows *sql.Rows) (Announcement, error) {
	var item Announcement
	var createdAt, updatedAt string
	if err := rows.Scan(&item.ID, &item.Title, &item.Body, &createdAt, &updatedAt); err != nil {
		return item, fmt.Errorf("scan announcement: %w", err)
	}
	return hydrateAnnouncement(item, createdAt, updatedAt)
}

func scanAnnouncementRow(row *sql.Row) (Announcement, error) {
	var item Announcement
	var createdAt, updatedAt string
	if err := row.Scan(&item.ID, &item.Title, &item.Body, &createdAt, &updatedAt); err != nil {
		return item, err
	}
	return hydrateAnnouncement(item, createdAt, updatedAt)
}

func hydrateAnnouncement(item Announcement, createdAt string, updatedAt string) (Announcement, error) {
	parsed, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return item, fmt.Errorf("parse announcement created_at: %w", err)
	}
	item.CreatedAt = parsed
	parsed, err = time.Parse(time.RFC3339, updatedAt)
	if err != nil {
		return item, fmt.Errorf("parse announcement updated_at: %w", err)
	}
	item.UpdatedAt = parsed
	return item, nil
}
