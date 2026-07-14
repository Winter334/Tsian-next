package cloudbackup

import (
	"context"
	"errors"
	"time"
)

const (
	QuotaBytes       int64 = 100 * 1024 * 1024
	MaxJSONBodyBytes int64 = 2 * 1024 * 1024
	MaxBlobBodyBytes int64 = QuotaBytes + 1024
)

var (
	ErrNotFound = errors.New("cloud backup not found")
	ErrConflict = errors.New("cloud backup revision conflict")
)

type FileKind string

const (
	FileKindText   FileKind = "text"
	FileKindBinary FileKind = "binary"
)

type FileEntry struct {
	Path      string   `json:"path"`
	Hash      string   `json:"hash"`
	Size      int64    `json:"size"`
	MediaType string   `json:"mediaType"`
	Kind      FileKind `json:"kind"`
	CreatedAt int64    `json:"createdAt"`
	UpdatedAt int64    `json:"updatedAt"`
}

type Backup struct {
	ID           string
	OwnerUserID  string
	Name         string
	CardID       string
	CardVersion  string
	RevisionID   string
	ManifestJSON string
	SizeBytes    int64
	FileCount    int
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type BlobRecord struct {
	OwnerUserID string
	Hash        string
	SizeBytes   int64
	MediaType   string
	StorageKey  string
	CreatedAt   time.Time
}

type UpsertInput struct {
	ID           string
	OwnerUserID  string
	Name         string
	CardID       string
	CardVersion  string
	RevisionID   string
	ManifestJSON string
	SizeBytes    int64
	FileCount    int
}

type Repository interface {
	List(ctx context.Context, ownerUserID string, cardID string) ([]Backup, error)
	Get(ctx context.Context, ownerUserID string, id string) (Backup, error)
	TotalUsage(ctx context.Context, ownerUserID string) (int64, error)
	Upsert(ctx context.Context, input UpsertInput) (Backup, error)
	Delete(ctx context.Context, ownerUserID string, id string) error
	GetBlob(ctx context.Context, ownerUserID string, hash string) (BlobRecord, error)
	PutBlob(ctx context.Context, record BlobRecord) error
	ListBlobs(ctx context.Context, ownerUserID string) ([]BlobRecord, error)
	DeleteBlob(ctx context.Context, ownerUserID string, hash string) error
}
