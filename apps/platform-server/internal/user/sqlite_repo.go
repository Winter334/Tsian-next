package user

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

func (r *SQLiteRepository) FindByID(ctx context.Context, id string) (*User, error) {
	return r.find(ctx, `SELECT id, handle, display_name, avatar_url, created_at, updated_at FROM users WHERE id = ?`, id)
}

func (r *SQLiteRepository) FindByIdentity(ctx context.Context, provider AuthProvider, subject string) (*User, error) {
	return r.find(
		ctx,
		`SELECT u.id, u.handle, u.display_name, u.avatar_url, u.created_at, u.updated_at
			FROM users u
			INNER JOIN auth_identities i ON i.user_id = u.id
			WHERE i.provider = ? AND i.subject = ?`,
		string(provider),
		subject,
	)
}

func (r *SQLiteRepository) UpsertDiscord(ctx context.Context, identity DiscordIdentity) (*User, error) {
	now := time.Now().UTC()
	existing, err := r.FindByIdentity(ctx, ProviderDiscord, identity.DiscordID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if existing != nil {
		_, err := r.db.ExecContext(
			ctx,
			`UPDATE users SET display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?`,
			identity.Username,
			nullString(identity.AvatarURL),
			now.Format(time.RFC3339),
			existing.ID,
		)
		if err != nil {
			return nil, fmt.Errorf("update discord user: %w", err)
		}
		_, err = r.db.ExecContext(
			ctx,
			`UPDATE auth_identities SET updated_at = ? WHERE provider = ? AND subject = ?`,
			now.Format(time.RFC3339),
			string(ProviderDiscord),
			identity.DiscordID,
		)
		if err != nil {
			return nil, fmt.Errorf("update discord identity: %w", err)
		}
		return r.FindByID(ctx, existing.ID)
	}

	accountID, err := NewID()
	if err != nil {
		return nil, err
	}
	identityID, err := NewID()
	if err != nil {
		return nil, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin user upsert transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO users (id, handle, display_name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
		accountID,
		"discord-"+identity.DiscordID,
		identity.Username,
		nullString(identity.AvatarURL),
		now.Format(time.RFC3339),
		now.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}
	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO auth_identities (id, user_id, provider, subject, credential_hash, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
		identityID,
		accountID,
		string(ProviderDiscord),
		identity.DiscordID,
		now.Format(time.RFC3339),
		now.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("insert discord identity: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit user upsert transaction: %w", err)
	}
	return r.FindByID(ctx, accountID)
}

func (r *SQLiteRepository) find(ctx context.Context, query string, args ...any) (*User, error) {
	var record User
	var avatar sql.NullString
	var createdAt string
	var updatedAt string
	err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&record.ID,
		&record.Handle,
		&record.DisplayName,
		&avatar,
		&createdAt,
		&updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query user: %w", err)
	}
	if avatar.Valid {
		record.AvatarURL = &avatar.String
	}
	parsedCreatedAt, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return nil, fmt.Errorf("parse user created_at: %w", err)
	}
	parsedUpdatedAt, err := time.Parse(time.RFC3339, updatedAt)
	if err != nil {
		return nil, fmt.Errorf("parse user updated_at: %w", err)
	}
	record.CreatedAt = parsedCreatedAt
	record.UpdatedAt = parsedUpdatedAt
	providers, err := r.authProviders(ctx, record.ID)
	if err != nil {
		return nil, err
	}
	record.AuthProviders = providers
	return &record, nil
}

func (r *SQLiteRepository) authProviders(ctx context.Context, userID string) ([]AuthProvider, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT provider FROM auth_identities WHERE user_id = ? ORDER BY provider`, userID)
	if err != nil {
		return nil, fmt.Errorf("query user auth providers: %w", err)
	}
	defer rows.Close()

	providers := make([]AuthProvider, 0, 1)
	for rows.Next() {
		var provider string
		if err := rows.Scan(&provider); err != nil {
			return nil, fmt.Errorf("scan auth provider: %w", err)
		}
		providers = append(providers, AuthProvider(provider))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate auth providers: %w", err)
	}
	return providers, nil
}

func nullString(value *string) sql.NullString {
	if value == nil || *value == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: *value, Valid: true}
}
