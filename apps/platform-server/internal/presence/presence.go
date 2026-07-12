package presence

import (
	"context"
	"time"
)

const (
	CookieName      = "tsian_presence"
	ActiveWindow    = 60 * time.Second
	RetentionWindow = 10 * time.Minute
	CookieMaxAge    = 30 * 24 * time.Hour
)

type Summary struct {
	OnlineCount         int
	ActiveWindowSeconds int
}

type Repository interface {
	Heartbeat(ctx context.Context, sessionID string, userID *string, now time.Time) error
	CountActive(ctx context.Context, since time.Time) (int, error)
	PruneBefore(ctx context.Context, before time.Time) error
}
