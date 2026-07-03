package market

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const (
	listSortNewest    = "newest"
	listSortDownloads = "downloads"
)

var ErrInvalidCursor = errors.New("invalid market cursor")

type listCursor struct {
	Sort          string `json:"sort"`
	CreatedAt     string `json:"createdAt"`
	DownloadCount int    `json:"downloadCount,omitempty"`
	ID            string `json:"id"`
}

func normalizedListSort(value string) string {
	if value == listSortDownloads {
		return listSortDownloads
	}
	return listSortNewest
}

func encodeListCursor(sort string, item PackageWithUploader) (string, error) {
	payload := listCursor{
		Sort:          normalizedListSort(sort),
		CreatedAt:     item.CreatedAt.Format(time.RFC3339),
		DownloadCount: item.DownloadCount,
		ID:            item.ID,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal market cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func decodeListCursor(value string, sort string) (*listCursor, error) {
	if value == "" {
		return nil, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, ErrInvalidCursor
	}
	var payload listCursor
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, ErrInvalidCursor
	}
	if payload.ID == "" || payload.CreatedAt == "" || payload.Sort != normalizedListSort(sort) {
		return nil, ErrInvalidCursor
	}
	if _, err := time.Parse(time.RFC3339, payload.CreatedAt); err != nil {
		return nil, ErrInvalidCursor
	}
	return &payload, nil
}
