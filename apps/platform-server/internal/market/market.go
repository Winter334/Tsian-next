package market

import (
	"context"
	"time"
)

type ResourceType string

const (
	ResourceGameCard ResourceType = "game_card"
	ResourceAgent    ResourceType = "agent"
	ResourceSkill    ResourceType = "skill"
)

type Package struct {
	ID              string
	ResourceType    ResourceType
	ResourceID      string
	ResourceAuthor  string
	ResourceVersion string
	Name            string
	Summary         string
	Tags            []string
	CoverBlobKey    string
	UploaderID      string
	DownloadCount   int
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// PackageWithUploader joins the uploader's display info from the users table.
type PackageWithUploader struct {
	Package
	UploaderDisplayName string
	UploaderAvatarURL   *string
}

type ListFilter struct {
	Query        string // empty = no filter
	Sort         string // "newest" | "downloads"
	Limit        int
	ResourceType ResourceType // empty = no resource-type filter
	Tag          string       // empty = no tag filter
}

type Repository interface {
	List(ctx context.Context, filter ListFilter) ([]PackageWithUploader, error)
	GetByID(ctx context.Context, id string) (*PackageWithUploader, error)
	Create(ctx context.Context, pkg Package) error
	IncrementDownloadCount(ctx context.Context, id string) error
}
