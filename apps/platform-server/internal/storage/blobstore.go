package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type BlobStore interface {
	Put(ctx context.Context, key string, content io.Reader) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

// FileSystemBlobStore stores blobs on the local filesystem under root.
// Keys are relative paths (e.g. "market/<id>.zip"); the store joins them
// with root. All file operations go through this struct so swapping to an
// object-storage backend later only requires a new BlobStore implementation.
type FileSystemBlobStore struct {
	Root string
}

func (s *FileSystemBlobStore) Put(_ context.Context, key string, content io.Reader) error {
	full := filepath.Join(s.Root, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return fmt.Errorf("create blob directory: %w", err)
	}
	file, err := os.Create(full)
	if err != nil {
		return fmt.Errorf("create blob: %w", err)
	}
	defer file.Close()
	if _, err := io.Copy(file, content); err != nil {
		return fmt.Errorf("write blob: %w", err)
	}
	return nil
}

func (s *FileSystemBlobStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	full := filepath.Join(s.Root, filepath.FromSlash(key))
	file, err := os.Open(full)
	if err != nil {
		return nil, fmt.Errorf("open blob: %w", err)
	}
	return file, nil
}

func (s *FileSystemBlobStore) Delete(_ context.Context, key string) error {
	full := filepath.Join(s.Root, filepath.FromSlash(key))
	if err := os.Remove(full); err != nil {
		return fmt.Errorf("delete blob: %w", err)
	}
	return nil
}
