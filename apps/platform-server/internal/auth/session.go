package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"time"
)

const SessionCookieName = "tsian_session"

const sessionTTL = 30 * 24 * time.Hour

func GenerateToken() (string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes[:]), nil
}

func CreateSession(db *sql.DB, userID string) (string, error) {
	token, err := GenerateToken()
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	expiresAt := now.Add(sessionTTL)
	_, err = db.Exec(
		`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		token,
		userID,
		expiresAt.Format(time.RFC3339),
		now.Format(time.RFC3339),
	)
	if err != nil {
		return "", fmt.Errorf("create session: %w", err)
	}
	return token, nil
}

func ValidateSession(db *sql.DB, token string) (string, error) {
	var userID string
	var expiresAt string
	err := db.QueryRow(`SELECT user_id, expires_at FROM sessions WHERE token = ?`, token).Scan(&userID, &expiresAt)
	if err != nil {
		return "", err
	}
	parsedExpiresAt, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		return "", fmt.Errorf("parse session expires_at: %w", err)
	}
	if time.Now().UTC().After(parsedExpiresAt) {
		_, _ = db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
		return "", sql.ErrNoRows
	}
	return userID, nil
}

func DeleteSession(db *sql.DB, token string) error {
	_, err := db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}
