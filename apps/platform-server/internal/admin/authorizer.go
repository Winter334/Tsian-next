package admin

import (
	"context"
	"database/sql"
	"strings"

	"tsian/platform-server/internal/config"
)

type Authorizer struct {
	allowedDiscordIDs map[string]struct{}
}

func NewAuthorizer(cfg config.Config) *Authorizer {
	allowed := make(map[string]struct{}, len(cfg.AdminDiscordIDs))
	for _, id := range cfg.AdminDiscordIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed != "" {
			allowed[trimmed] = struct{}{}
		}
	}
	return &Authorizer{allowedDiscordIDs: allowed}
}

func (a *Authorizer) IsAdmin(ctx context.Context, db *sql.DB, userID string) (bool, error) {
	if userID == "" || len(a.allowedDiscordIDs) == 0 {
		return false, nil
	}

	rows, err := db.QueryContext(ctx, `SELECT subject FROM auth_identities WHERE user_id = ? AND provider = 'discord'`, userID)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var subject string
		if err := rows.Scan(&subject); err != nil {
			return false, err
		}
		if _, ok := a.allowedDiscordIDs[subject]; ok {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return false, nil
}
