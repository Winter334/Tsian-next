package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// LoadDefaultEnvFiles loads project/server .env files before Config is read.
// Later files override earlier files, but real process env vars always win.
func LoadDefaultEnvFiles() error {
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("get working directory: %w", err)
	}

	paths := make([]string, 0, 6)
	if root, ok := findProjectRoot(cwd); ok {
		paths = append(paths,
			filepath.Join(root, ".env"),
			filepath.Join(root, ".env.local"),
			filepath.Join(root, "apps", "platform-server", ".env"),
			filepath.Join(root, "apps", "platform-server", ".env.local"),
		)
	}
	paths = append(paths,
		filepath.Join(cwd, ".env"),
		filepath.Join(cwd, ".env.local"),
	)

	return LoadEnvFiles(paths...)
}

func LoadEnvFiles(paths ...string) error {
	values := map[string]string{}
	seen := map[string]struct{}{}

	for _, path := range paths {
		absolutePath, err := filepath.Abs(path)
		if err != nil {
			return fmt.Errorf("resolve env path %q: %w", path, err)
		}
		if _, ok := seen[absolutePath]; ok {
			continue
		}
		seen[absolutePath] = struct{}{}

		parsed, err := parseEnvFile(absolutePath)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		for key, value := range parsed {
			values[key] = value
		}
	}

	for key, value := range values {
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("set env %s: %w", key, err)
		}
	}
	return nil
}

func parseEnvFile(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	values := map[string]string{}
	scanner := bufio.NewScanner(file)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}

		key, rawValue, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("parse %s:%d: missing '='", path, lineNumber)
		}
		key = strings.TrimSpace(key)
		if !validEnvKey(key) {
			return nil, fmt.Errorf("parse %s:%d: invalid env key", path, lineNumber)
		}

		value, err := parseEnvValue(strings.TrimSpace(rawValue))
		if err != nil {
			return nil, fmt.Errorf("parse %s:%d: %w", path, lineNumber, err)
		}
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return values, nil
}

func parseEnvValue(value string) (string, error) {
	if value == "" {
		return "", nil
	}

	quote := value[0]
	if quote == '\'' || quote == '"' {
		end := closingQuoteIndex(value, quote)
		if end < 0 {
			return "", fmt.Errorf("unterminated quoted value")
		}
		trailing := strings.TrimSpace(value[end+1:])
		if trailing != "" && !strings.HasPrefix(trailing, "#") {
			return "", fmt.Errorf("unexpected trailing characters after quoted value")
		}

		quoted := value[:end+1]
		if quote == '\'' {
			return quoted[1 : len(quoted)-1], nil
		}
		unquoted, err := strconv.Unquote(quoted)
		if err != nil {
			return "", fmt.Errorf("invalid quoted value: %w", err)
		}
		return unquoted, nil
	}

	return strings.TrimSpace(stripInlineComment(value)), nil
}

func closingQuoteIndex(value string, quote byte) int {
	for i := 1; i < len(value); i++ {
		if quote == '"' && value[i] == '\\' {
			i++
			continue
		}
		if value[i] == quote {
			return i
		}
	}
	return -1
}

func stripInlineComment(value string) string {
	for i := 0; i < len(value); i++ {
		if value[i] == '#' && (i == 0 || value[i-1] == ' ' || value[i-1] == '\t') {
			return value[:i]
		}
	}
	return value
}

func validEnvKey(key string) bool {
	if key == "" {
		return false
	}
	for i := 0; i < len(key); i++ {
		char := key[i]
		if char == '_' || char >= 'A' && char <= 'Z' || char >= 'a' && char <= 'z' {
			continue
		}
		if i > 0 && char >= '0' && char <= '9' {
			continue
		}
		return false
	}
	return true
}

func findProjectRoot(start string) (string, bool) {
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", false
	}

	for {
		if fileExists(filepath.Join(dir, "package.json")) && dirExists(filepath.Join(dir, "apps", "platform-server")) {
			return dir, true
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
