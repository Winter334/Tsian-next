package user

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"
)

var ErrNotFound = errors.New("user not found")

type AuthProvider string

const (
	ProviderDiscord        AuthProvider = "discord"
	ProviderPassword       AuthProvider = "password"
	ProviderEmailMagicLink AuthProvider = "email_magic_link"
)

type User struct {
	ID            string
	Handle        string
	DisplayName   string
	AvatarURL     *string
	AuthProviders []AuthProvider
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type DiscordIdentity struct {
	DiscordID string
	Username  string
	AvatarURL *string
}

type Repository interface {
	FindByID(ctx context.Context, id string) (*User, error)
	FindByIdentity(ctx context.Context, provider AuthProvider, subject string) (*User, error)
	UpsertDiscord(ctx context.Context, identity DiscordIdentity) (*User, error)
}

func FromContext(ctx context.Context) (*User, bool) {
	value, ok := ctx.Value(contextKey{}).(*User)
	return value, ok
}

func ContextWithUser(ctx context.Context, account *User) context.Context {
	return context.WithValue(ctx, contextKey{}, account)
}

type contextKey struct{}

func NewID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("generate user id: %w", err)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
