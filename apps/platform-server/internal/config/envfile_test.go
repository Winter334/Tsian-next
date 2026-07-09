package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvFilesLaterFilesOverrideEarlierFiles(t *testing.T) {
	t.Setenv("TSIAN_ENV_LOADER_TEST_VALUE", "")
	_ = os.Unsetenv("TSIAN_ENV_LOADER_TEST_VALUE")

	dir := t.TempDir()
	first := filepath.Join(dir, ".env")
	second := filepath.Join(dir, ".env.local")
	writeEnvFile(t, first, "TSIAN_ENV_LOADER_TEST_VALUE=first\n")
	writeEnvFile(t, second, "TSIAN_ENV_LOADER_TEST_VALUE=second\n")

	if err := LoadEnvFiles(first, second); err != nil {
		t.Fatalf("LoadEnvFiles: %v", err)
	}
	if value := os.Getenv("TSIAN_ENV_LOADER_TEST_VALUE"); value != "second" {
		t.Fatalf("env value = %q, want %q", value, "second")
	}
}

func TestLoadEnvFilesDoesNotOverrideProcessEnv(t *testing.T) {
	t.Setenv("TSIAN_ENV_LOADER_TEST_EXISTING", "process")

	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	writeEnvFile(t, path, "TSIAN_ENV_LOADER_TEST_EXISTING=file\n")

	if err := LoadEnvFiles(path); err != nil {
		t.Fatalf("LoadEnvFiles: %v", err)
	}
	if value := os.Getenv("TSIAN_ENV_LOADER_TEST_EXISTING"); value != "process" {
		t.Fatalf("env value = %q, want %q", value, "process")
	}
}

func TestLoadEnvFilesParsesCommentsAndQuotedValues(t *testing.T) {
	keys := []string{
		"TSIAN_ENV_LOADER_TEST_UNQUOTED",
		"TSIAN_ENV_LOADER_TEST_SINGLE_QUOTED",
		"TSIAN_ENV_LOADER_TEST_DOUBLE_QUOTED",
	}
	for _, key := range keys {
		_ = os.Unsetenv(key)
	}
	t.Cleanup(func() {
		for _, key := range keys {
			_ = os.Unsetenv(key)
		}
	})

	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	writeEnvFile(t, path, `# comment
export TSIAN_ENV_LOADER_TEST_UNQUOTED=value # inline comment
TSIAN_ENV_LOADER_TEST_SINGLE_QUOTED='value # kept'
TSIAN_ENV_LOADER_TEST_DOUBLE_QUOTED="line\nvalue"
`)

	if err := LoadEnvFiles(path); err != nil {
		t.Fatalf("LoadEnvFiles: %v", err)
	}
	assertEnv(t, "TSIAN_ENV_LOADER_TEST_UNQUOTED", "value")
	assertEnv(t, "TSIAN_ENV_LOADER_TEST_SINGLE_QUOTED", "value # kept")
	assertEnv(t, "TSIAN_ENV_LOADER_TEST_DOUBLE_QUOTED", "line\nvalue")
}

func TestLoadEnvFilesRejectsInvalidLine(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	writeEnvFile(t, path, "TSIAN_ENV_LOADER_TEST_INVALID\n")

	if err := LoadEnvFiles(path); err == nil {
		t.Fatalf("LoadEnvFiles succeeded, want error")
	}
}

func writeEnvFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
}

func assertEnv(t *testing.T, key string, want string) {
	t.Helper()
	if value := os.Getenv(key); value != want {
		t.Fatalf("%s = %q, want %q", key, value, want)
	}
}
