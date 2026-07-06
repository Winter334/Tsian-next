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
	ResourceTool     ResourceType = "tool"
)

type Package struct {
	ID                string
	ResourceType      ResourceType
	ResourceID        string
	ResourceAuthor    string
	ResourceVersion   string
	Name              string
	Summary           string
	Tags              []string
	CoverBlobKey      string
	CoverThumbBlobKey string
	UploaderID        string
	DownloadCount     int
	CreatedAt         time.Time
	UpdatedAt         time.Time
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
	Cursor       string
	ResourceType ResourceType // empty = no resource-type filter
	Tag          string       // empty = no tag filter
	UploaderID   string       // empty = all uploaders
}

type CountFilter struct {
	UploaderID string // empty = all uploaders
}

type ListResult struct {
	Items      []PackageWithUploader
	NextCursor string
}

type CountsByResourceType map[ResourceType]int

type PackageUpdate struct {
	ResourceID        string
	ResourceAuthor    string
	ResourceVersion   string
	Name              string
	Summary           string
	Tags              []string
	CoverBlobKey      string
	CoverThumbBlobKey string
}

type Repository interface {
	List(ctx context.Context, filter ListFilter) (ListResult, error)
	Counts(ctx context.Context, filter CountFilter) (CountsByResourceType, error)
	GetByID(ctx context.Context, id string) (*PackageWithUploader, error)
	Create(ctx context.Context, pkg Package) error
	Update(ctx context.Context, id string, update PackageUpdate) error
	Delete(ctx context.Context, id string) error
	IncrementDownloadCount(ctx context.Context, id string) error
}
