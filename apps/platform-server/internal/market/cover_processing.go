package market

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/gen2brain/webp"
)

const (
	coverPackagePath      = "cover/cover.webp"
	coverWorkspacePath    = ".cover/cover.webp"
	coverMediaType        = "image/webp"
	displayCoverMaxEdge   = 1280
	displayCoverQuality   = 72
	thumbCoverWidth       = 512
	thumbCoverHeight      = 640
	thumbCoverQuality     = 68
	maxCoverInputBytes    = 50 << 20
	maxCoverDecodedPixels = 36_000_000
)

type processedCoverPackage struct {
	Content []byte
	Display []byte
	Thumb   []byte
}

func processGameCardPackageCover(content []byte) (processedCoverPackage, error) {
	result := processedCoverPackage{Content: content}
	coverBytes, found := firstPackageCover(content)
	if !found {
		return result, nil
	}

	img, err := decodeCoverImage(coverBytes.name, coverBytes.data)
	if err != nil {
		return stripPackageCover(content)
	}

	display, err := encodeDisplayCover(img)
	if err != nil {
		return stripPackageCover(content)
	}
	thumb, err := encodeThumbCover(img)
	if err != nil {
		return stripPackageCover(content)
	}
	rewritten, err := rewritePackageCover(content, display)
	if err != nil {
		return processedCoverPackage{}, err
	}

	result.Content = rewritten
	result.Display = display
	result.Thumb = thumb
	return result, nil
}

func stripPackageCover(content []byte) (processedCoverPackage, error) {
	stripped, err := rewritePackageCover(content, nil)
	if err != nil {
		return processedCoverPackage{}, err
	}
	return processedCoverPackage{Content: stripped}, nil
}

type packageCoverFile struct {
	name string
	data []byte
}

func firstPackageCover(content []byte) (packageCoverFile, bool) {
	zipReader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return packageCoverFile{}, false
	}
	for _, f := range zipReader.File {
		if !strings.HasPrefix(f.Name, "cover/") || f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return packageCoverFile{}, false
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil || len(data) == 0 {
			return packageCoverFile{}, false
		}
		return packageCoverFile{name: f.Name, data: data}, true
	}
	return packageCoverFile{}, false
}

func decodeCoverImage(name string, data []byte) (image.Image, error) {
	if len(data) == 0 || len(data) > maxCoverInputBytes {
		return nil, errors.New("cover input size is invalid")
	}
	if !supportedCoverExtension(name) {
		return nil, fmt.Errorf("unsupported cover type: %s", filepath.Ext(name))
	}
	config, err := decodeCoverConfig(name, data)
	if err != nil {
		return nil, err
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width*config.Height > maxCoverDecodedPixels {
		return nil, errors.New("cover dimensions are invalid")
	}
	if isWebPExtension(name) {
		return webp.Decode(bytes.NewReader(data), webp.Options{AutoRotate: true})
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	return img, err
}

func decodeCoverConfig(name string, data []byte) (image.Config, error) {
	if isWebPExtension(name) {
		return webp.DecodeConfig(bytes.NewReader(data))
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	return config, err
}

func supportedCoverExtension(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		return true
	default:
		return false
	}
}

func isWebPExtension(name string) bool {
	return strings.EqualFold(filepath.Ext(name), ".webp")
}

func encodeDisplayCover(img image.Image) ([]byte, error) {
	resized := imaging.Fit(img, displayCoverMaxEdge, displayCoverMaxEdge, imaging.Lanczos)
	return encodeCoverWebP(resized, displayCoverQuality)
}

func encodeThumbCover(img image.Image) ([]byte, error) {
	thumb := imaging.Fill(img, thumbCoverWidth, thumbCoverHeight, imaging.Center, imaging.Lanczos)
	return encodeCoverWebP(thumb, thumbCoverQuality)
}

func encodeCoverWebP(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	if err := webp.Encode(&buf, img, webp.Options{Quality: quality, Method: webp.DefaultMethod}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func rewritePackageCover(content []byte, displayCover []byte) ([]byte, error) {
	zipReader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return nil, err
	}

	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for _, f := range zipReader.File {
		if f.FileInfo().IsDir() || strings.HasPrefix(f.Name, "cover/") {
			continue
		}
		data, err := readZipFile(f)
		if err != nil {
			_ = writer.Close()
			return nil, err
		}
		if f.Name == "game-card.json" {
			data, err = rewritePackageManifestCover(data, len(displayCover), displayCover != nil)
			if err != nil {
				_ = writer.Close()
				return nil, err
			}
		}
		entry, err := writer.Create(f.Name)
		if err != nil {
			_ = writer.Close()
			return nil, err
		}
		if _, err := entry.Write(data); err != nil {
			_ = writer.Close()
			return nil, err
		}
	}

	if displayCover != nil {
		entry, err := writer.Create(coverPackagePath)
		if err != nil {
			_ = writer.Close()
			return nil, err
		}
		if _, err := entry.Write(displayCover); err != nil {
			_ = writer.Close()
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func rewritePackageManifestCover(data []byte, coverSize int, hasCover bool) ([]byte, error) {
	var manifest map[string]any
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}
	innerManifest, _ := manifest["manifest"].(map[string]any)
	if innerManifest == nil {
		innerManifest = map[string]any{}
	}
	if hasCover {
		manifest["coverFiles"] = []map[string]any{{
			"path":      coverPackagePath,
			"mediaType": coverMediaType,
			"size":      coverSize,
		}}
		cover := map[string]any{"workspacePath": coverWorkspacePath}
		if existing, ok := innerManifest["cover"].(map[string]any); ok {
			if alt, ok := existing["alt"].(string); ok && strings.TrimSpace(alt) != "" {
				cover["alt"] = alt
			}
		}
		innerManifest["cover"] = cover
	} else {
		delete(manifest, "coverFiles")
		delete(innerManifest, "cover")
	}
	manifest["manifest"] = innerManifest
	return json.MarshalIndent(manifest, "", "  ")
}
