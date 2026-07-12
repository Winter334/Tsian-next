package announcement

import (
	"context"
	"errors"
	"strings"
	"time"
)

const (
	MaxTitleLength = 120
	MaxBodyLength  = 10000
)

var ErrNotFound = errors.New("announcement not found")

type Announcement struct {
	ID        string
	Title     string
	Body      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Input struct {
	Title string
	Body  string
}

type Repository interface {
	List(ctx context.Context, limit int) ([]Announcement, error)
	Create(ctx context.Context, input Input) (Announcement, error)
	Update(ctx context.Context, id string, input Input) (Announcement, error)
	Delete(ctx context.Context, id string) error
}

func NormalizeInput(input Input) (Input, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return Input{}, errors.New("title is required")
	}
	if len([]rune(title)) > MaxTitleLength {
		return Input{}, errors.New("title is too long")
	}
	body := strings.TrimSpace(input.Body)
	if body == "" {
		return Input{}, errors.New("body is required")
	}
	if len([]rune(body)) > MaxBodyLength {
		return Input{}, errors.New("body is too long")
	}
	return Input{Title: title, Body: body}, nil
}
