package cloudbackup

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

func (r *SQLiteRepository) List(ctx context.Context, ownerUserID string, cardID string) ([]Backup, error) {
	query := `SELECT id, owner_user_id, name, card_id, card_version, revision_id, manifest_json, size_bytes, file_count, created_at, updated_at
		FROM cloud_backups WHERE owner_user_id = ?`
	args := []any{ownerUserID}
	if cardID != "" {
		query += ` AND card_id = ?`
		args = append(args, cardID)
	}
	query += ` ORDER BY updated_at DESC, id DESC`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query cloud backups: %w", err)
	}
	defer rows.Close()

	items := make([]Backup, 0)
	for rows.Next() {
		item, err := scanBackup(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cloud backups: %w", err)
	}
	return items, nil
}

func (r *SQLiteRepository) Get(ctx context.Context, ownerUserID string, id string) (Backup, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id, owner_user_id, name, card_id, card_version, revision_id, manifest_json, size_bytes, file_count, created_at, updated_at
		FROM cloud_backups WHERE owner_user_id = ? AND id = ?`, ownerUserID, id)
	item, err := scanBackupRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Backup{}, ErrNotFound
	}
	if err != nil {
		return Backup{}, err
	}
	return item, nil
}

func (r *SQLiteRepository) TotalUsage(ctx context.Context, ownerUserID string) (int64, error) {
	var total sql.NullInt64
	if err := r.db.QueryRowContext(ctx, `SELECT SUM(size_bytes) FROM cloud_backups WHERE owner_user_id = ?`, ownerUserID).Scan(&total); err != nil {
		return 0, fmt.Errorf("sum cloud backup usage: %w", err)
	}
	if !total.Valid {
		return 0, nil
	}
	return total.Int64, nil
}

func (r *SQLiteRepository) Upsert(ctx context.Context, input UpsertInput) (Backup, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := r.db.ExecContext(ctx, `INSERT INTO cloud_backups
		(id, owner_user_id, name, card_id, card_version, revision_id, manifest_json, size_bytes, file_count, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			card_id = excluded.card_id,
			card_version = excluded.card_version,
			revision_id = excluded.revision_id,
			manifest_json = excluded.manifest_json,
			size_bytes = excluded.size_bytes,
			file_count = excluded.file_count,
			updated_at = excluded.updated_at
		WHERE cloud_backups.owner_user_id = excluded.owner_user_id`,
		input.ID,
		input.OwnerUserID,
		input.Name,
		input.CardID,
		input.CardVersion,
		input.RevisionID,
		input.ManifestJSON,
		input.SizeBytes,
		input.FileCount,
		now,
		now,
	)
	if err != nil {
		return Backup{}, fmt.Errorf("upsert cloud backup: %w", err)
	}
	return r.Get(ctx, input.OwnerUserID, input.ID)
}

func (r *SQLiteRepository) Delete(ctx context.Context, ownerUserID string, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM cloud_backups WHERE owner_user_id = ? AND id = ?`, ownerUserID, id)
	if err != nil {
		return fmt.Errorf("delete cloud backup: %w", err)
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SQLiteRepository) GetBlob(ctx context.Context, ownerUserID string, hash string) (BlobRecord, error) {
	row := r.db.QueryRowContext(ctx, `SELECT owner_user_id, hash, size_bytes, media_type, storage_key, created_at
		FROM cloud_backup_blobs WHERE owner_user_id = ? AND hash = ?`, ownerUserID, hash)
	item, err := scanBlobRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return BlobRecord{}, ErrNotFound
	}
	if err != nil {
		return BlobRecord{}, err
	}
	return item, nil
}

func (r *SQLiteRepository) PutBlob(ctx context.Context, record BlobRecord) error {
	createdAt := record.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	_, err := r.db.ExecContext(ctx, `INSERT INTO cloud_backup_blobs
		(owner_user_id, hash, size_bytes, media_type, storage_key, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(owner_user_id, hash) DO UPDATE SET
			size_bytes = excluded.size_bytes,
			media_type = excluded.media_type,
			storage_key = excluded.storage_key`,
		record.OwnerUserID,
		record.Hash,
		record.SizeBytes,
		record.MediaType,
		record.StorageKey,
		createdAt.Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("put cloud backup blob: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) ListBlobs(ctx context.Context, ownerUserID string) ([]BlobRecord, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT owner_user_id, hash, size_bytes, media_type, storage_key, created_at
		FROM cloud_backup_blobs WHERE owner_user_id = ?`, ownerUserID)
	if err != nil {
		return nil, fmt.Errorf("query cloud backup blobs: %w", err)
	}
	defer rows.Close()
	items := make([]BlobRecord, 0)
	for rows.Next() {
		item, err := scanBlob(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cloud backup blobs: %w", err)
	}
	return items, nil
}

func (r *SQLiteRepository) DeleteBlob(ctx context.Context, ownerUserID string, hash string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM cloud_backup_blobs WHERE owner_user_id = ? AND hash = ?`, ownerUserID, hash)
	if err != nil {
		return fmt.Errorf("delete cloud backup blob: %w", err)
	}
	return nil
}

func scanBackup(rows *sql.Rows) (Backup, error) {
	var item Backup
	var createdAt, updatedAt string
	if err := rows.Scan(&item.ID, &item.OwnerUserID, &item.Name, &item.CardID, &item.CardVersion, &item.RevisionID, &item.ManifestJSON, &item.SizeBytes, &item.FileCount, &createdAt, &updatedAt); err != nil {
		return item, fmt.Errorf("scan cloud backup: %w", err)
	}
	return hydrateBackup(item, createdAt, updatedAt)
}

func scanBackupRow(row *sql.Row) (Backup, error) {
	var item Backup
	var createdAt, updatedAt string
	if err := row.Scan(&item.ID, &item.OwnerUserID, &item.Name, &item.CardID, &item.CardVersion, &item.RevisionID, &item.ManifestJSON, &item.SizeBytes, &item.FileCount, &createdAt, &updatedAt); err != nil {
		return item, err
	}
	return hydrateBackup(item, createdAt, updatedAt)
}

func hydrateBackup(item Backup, createdAt string, updatedAt string) (Backup, error) {
	parsed, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return item, fmt.Errorf("parse cloud backup created_at: %w", err)
	}
	item.CreatedAt = parsed
	parsed, err = time.Parse(time.RFC3339, updatedAt)
	if err != nil {
		return item, fmt.Errorf("parse cloud backup updated_at: %w", err)
	}
	item.UpdatedAt = parsed
	return item, nil
}

func scanBlob(rows *sql.Rows) (BlobRecord, error) {
	var item BlobRecord
	var createdAt string
	if err := rows.Scan(&item.OwnerUserID, &item.Hash, &item.SizeBytes, &item.MediaType, &item.StorageKey, &createdAt); err != nil {
		return item, fmt.Errorf("scan cloud backup blob: %w", err)
	}
	return hydrateBlob(item, createdAt)
}

func scanBlobRow(row *sql.Row) (BlobRecord, error) {
	var item BlobRecord
	var createdAt string
	if err := row.Scan(&item.OwnerUserID, &item.Hash, &item.SizeBytes, &item.MediaType, &item.StorageKey, &createdAt); err != nil {
		return item, err
	}
	return hydrateBlob(item, createdAt)
}

func hydrateBlob(item BlobRecord, createdAt string) (BlobRecord, error) {
	parsed, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return item, fmt.Errorf("parse cloud backup blob created_at: %w", err)
	}
	item.CreatedAt = parsed
	return item, nil
}
