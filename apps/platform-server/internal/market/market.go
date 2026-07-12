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

type Visibility string

const (
	VisibilityVisible Visibility = "visible"
	VisibilityHidden  Visibility = "hidden"
	VisibilityAll     Visibility = "all"
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
	HiddenAt          *time.Time
	HiddenBy          *string
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
	Query         string // empty = no filter
	Sort          string // "newest" | "downloads"
	Limit         int
	Cursor        string
	ResourceType  ResourceType // empty = no resource-type filter
	Tag           string       // empty = no tag filter
	UploaderID    string       // empty = all uploaders
	UploaderQuery string       // empty = no uploader display/id filter
	Visibility    Visibility   // empty = public visible only; admin can use all/hidden
}

type CountFilter struct {
	UploaderID string     // empty = all uploaders
	Visibility Visibility // empty = public visible only; admin can use all/hidden
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

type MetadataUpdate struct {
	Name    string
	Summary string
	Tags    []string
}

func (u MetadataUpdate) ToPackageUpdate(existing PackageWithUploader) PackageUpdate {
	return PackageUpdate{
		ResourceID:        existing.ResourceID,
		ResourceAuthor:    existing.ResourceAuthor,
		ResourceVersion:   existing.ResourceVersion,
		Name:              u.Name,
		Summary:           u.Summary,
		Tags:              u.Tags,
		CoverBlobKey:      existing.CoverBlobKey,
		CoverThumbBlobKey: existing.CoverThumbBlobKey,
	}
}

type Repository interface {
	List(ctx context.Context, filter ListFilter) (ListResult, error)
	Counts(ctx context.Context, filter CountFilter) (CountsByResourceType, error)
	GetByID(ctx context.Context, id string) (*PackageWithUploader, error)
	GetByIDForAdmin(ctx context.Context, id string) (*PackageWithUploader, error)
	Create(ctx context.Context, pkg Package) error
	Update(ctx context.Context, id string, update PackageUpdate) error
	SetHidden(ctx context.Context, id string, hiddenBy string) error
	ClearHidden(ctx context.Context, id string) error
	Delete(ctx context.Context, id string) error
	IncrementDownloadCount(ctx context.Context, id string) error
}
