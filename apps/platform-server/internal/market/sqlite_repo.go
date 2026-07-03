package market

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type SQLiteRepository struct {
	db *sql.DB
}

func NewSQLiteRepository(db *sql.DB) *SQLiteRepository {
	return &SQLiteRepository{db: db}
}

func (r *SQLiteRepository) List(ctx context.Context, filter ListFilter) ([]PackageWithUploader, error) {
	query := `SELECT p.id, p.resource_type, p.card_id, p.card_author, p.card_version,
		p.name, p.summary, p.cover_blob_key, p.uploader_id, p.download_count, p.created_at, p.updated_at,
		u.display_name, u.avatar_url
		FROM market_packages p
		JOIN users u ON p.uploader_id = u.id`

	var args []any
	if filter.Query != "" {
		query += ` WHERE p.name LIKE ? OR p.summary LIKE ?`
		like := "%" + filter.Query + "%"
		args = append(args, like, like)
	}

	switch filter.Sort {
	case "downloads":
		query += ` ORDER BY p.download_count DESC, p.created_at DESC`
	default:
		query += ` ORDER BY p.created_at DESC`
	}

	limit := filter.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query += ` LIMIT ?`
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query market packages: %w", err)
	}
	defer rows.Close()

	var items []PackageWithUploader
	for rows.Next() {
		item, err := scanPackageWithUploader(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate market packages: %w", err)
	}
	return items, nil
}

func (r *SQLiteRepository) GetByID(ctx context.Context, id string) (*PackageWithUploader, error) {
	row := r.db.QueryRowContext(ctx, `SELECT p.id, p.resource_type, p.card_id, p.card_author, p.card_version,
		p.name, p.summary, p.cover_blob_key, p.uploader_id, p.download_count, p.created_at, p.updated_at,
		u.display_name, u.avatar_url
		FROM market_packages p
		JOIN users u ON p.uploader_id = u.id
		WHERE p.id = ?`, id)
	item, err := scanPackageWithUploaderRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *SQLiteRepository) Create(ctx context.Context, pkg Package) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := r.db.ExecContext(ctx, `INSERT INTO market_packages
		(id, resource_type, card_id, card_author, card_version, name, summary, cover_blob_key, uploader_id, download_count, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		pkg.ID, string(pkg.ResourceType), pkg.CardID, pkg.CardAuthor, pkg.CardVersion,
		pkg.Name, pkg.Summary, nullString(pkg.CoverBlobKey), pkg.UploaderID, now, now)
	if err != nil {
		return fmt.Errorf("insert market package: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) IncrementDownloadCount(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE market_packages SET download_count = download_count + 1, updated_at = ? WHERE id = ?`,
		time.Now().UTC().Format(time.RFC3339), id)
	if err != nil {
		return fmt.Errorf("increment download count: %w", err)
	}
	return nil
}

var ErrNotFound = errors.New("market package not found")

func scanPackageWithUploader(rows *sql.Rows) (PackageWithUploader, error) {
	var item PackageWithUploader
	var coverBlobKey sql.NullString
	var avatarURL sql.NullString
	var createdAt, updatedAt string
	if err := rows.Scan(
		&item.ID, (*string)(&item.ResourceType), &item.CardID, &item.CardAuthor, &item.CardVersion,
		&item.Name, &item.Summary, &coverBlobKey, &item.UploaderID, &item.DownloadCount, &createdAt, &updatedAt,
		&item.UploaderDisplayName, &avatarURL,
	); err != nil {
		return item, fmt.Errorf("scan market package: %w", err)
	}
	item.CoverBlobKey = coverBlobKey.String
	if avatarURL.Valid {
		avatar := avatarURL.String
		item.UploaderAvatarURL = &avatar
	}
	parsed, err := parseTime(createdAt)
	if err != nil {
		return item, err
	}
	item.CreatedAt = parsed
	parsed, err = parseTime(updatedAt)
	if err != nil {
		return item, err
	}
	item.UpdatedAt = parsed
	return item, nil
}

func scanPackageWithUploaderRow(row *sql.Row) (PackageWithUploader, error) {
	var item PackageWithUploader
	var coverBlobKey sql.NullString
	var avatarURL sql.NullString
	var createdAt, updatedAt string
	if err := row.Scan(
		&item.ID, (*string)(&item.ResourceType), &item.CardID, &item.CardAuthor, &item.CardVersion,
		&item.Name, &item.Summary, &coverBlobKey, &item.UploaderID, &item.DownloadCount, &createdAt, &updatedAt,
		&item.UploaderDisplayName, &avatarURL,
	); err != nil {
		return item, err
	}
	item.CoverBlobKey = coverBlobKey.String
	if avatarURL.Valid {
		avatar := avatarURL.String
		item.UploaderAvatarURL = &avatar
	}
	parsed, err := parseTime(createdAt)
	if err != nil {
		return item, err
	}
	item.CreatedAt = parsed
	parsed, err = parseTime(updatedAt)
	if err != nil {
		return item, err
	}
	item.UpdatedAt = parsed
	return item, nil
}

func parseTime(value string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse time: %w", err)
	}
	return t, nil
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
