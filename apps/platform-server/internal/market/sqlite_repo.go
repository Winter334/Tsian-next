package market

import (
	"context"
	"database/sql"
	"encoding/json"
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
	query := `SELECT p.id, p.resource_type, p.resource_id, p.resource_author, p.resource_version,
		p.name, p.summary, p.tags, p.cover_blob_key, p.uploader_id, p.download_count, p.created_at, p.updated_at,
		u.display_name, u.avatar_url
		FROM market_packages p
		JOIN users u ON p.uploader_id = u.id
		WHERE 1=1`

	var args []any
	if filter.ResourceType != "" {
		query += ` AND p.resource_type = ?`
		args = append(args, string(filter.ResourceType))
	}
	if filter.Query != "" {
		query += ` AND (p.name LIKE ? OR p.summary LIKE ?)`
		like := "%" + filter.Query + "%"
		args = append(args, like, like)
	}
	if filter.Tag != "" {
		query += ` AND p.tags LIKE ?`
		args = append(args, `%"`+filter.Tag+`"%`)
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
	row := r.db.QueryRowContext(ctx, `SELECT p.id, p.resource_type, p.resource_id, p.resource_author, p.resource_version,
		p.name, p.summary, p.tags, p.cover_blob_key, p.uploader_id, p.download_count, p.created_at, p.updated_at,
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
	tagsJSON, err := json.Marshal(pkg.Tags)
	if err != nil {
		return fmt.Errorf("marshal package tags: %w", err)
	}
	_, err = r.db.ExecContext(ctx, `INSERT INTO market_packages
		(id, resource_type, card_id, card_author, card_version, resource_id, resource_author, resource_version, name, summary, tags, cover_blob_key, uploader_id, download_count, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		pkg.ID, string(pkg.ResourceType), pkg.ResourceID, pkg.ResourceAuthor, pkg.ResourceVersion,
		pkg.ResourceID, pkg.ResourceAuthor, pkg.ResourceVersion, pkg.Name, pkg.Summary, string(tagsJSON),
		nullString(pkg.CoverBlobKey), pkg.UploaderID, now, now)
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
	var tagsJSON string
	var createdAt, updatedAt string
	if err := rows.Scan(
		&item.ID, (*string)(&item.ResourceType), &item.ResourceID, &item.ResourceAuthor, &item.ResourceVersion,
		&item.Name, &item.Summary, &tagsJSON, &coverBlobKey, &item.UploaderID, &item.DownloadCount, &createdAt, &updatedAt,
		&item.UploaderDisplayName, &avatarURL,
	); err != nil {
		return item, fmt.Errorf("scan market package: %w", err)
	}
	if err := hydratePackageFields(&item, coverBlobKey, avatarURL, tagsJSON, createdAt, updatedAt); err != nil {
		return item, err
	}
	return item, nil
}

func scanPackageWithUploaderRow(row *sql.Row) (PackageWithUploader, error) {
	var item PackageWithUploader
	var coverBlobKey sql.NullString
	var avatarURL sql.NullString
	var tagsJSON string
	var createdAt, updatedAt string
	if err := row.Scan(
		&item.ID, (*string)(&item.ResourceType), &item.ResourceID, &item.ResourceAuthor, &item.ResourceVersion,
		&item.Name, &item.Summary, &tagsJSON, &coverBlobKey, &item.UploaderID, &item.DownloadCount, &createdAt, &updatedAt,
		&item.UploaderDisplayName, &avatarURL,
	); err != nil {
		return item, err
	}
	if err := hydratePackageFields(&item, coverBlobKey, avatarURL, tagsJSON, createdAt, updatedAt); err != nil {
		return item, err
	}
	return item, nil
}

func hydratePackageFields(item *PackageWithUploader, coverBlobKey sql.NullString, avatarURL sql.NullString, tagsJSON string, createdAt string, updatedAt string) error {
	item.CoverBlobKey = coverBlobKey.String
	if avatarURL.Valid {
		avatar := avatarURL.String
		item.UploaderAvatarURL = &avatar
	}
	if err := json.Unmarshal([]byte(tagsJSON), &item.Tags); err != nil {
		return fmt.Errorf("parse package tags: %w", err)
	}
	if item.Tags == nil {
		item.Tags = []string{}
	}
	parsed, err := parseTime(createdAt)
	if err != nil {
		return err
	}
	item.CreatedAt = parsed
	parsed, err = parseTime(updatedAt)
	if err != nil {
		return err
	}
	item.UpdatedAt = parsed
	return nil
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
