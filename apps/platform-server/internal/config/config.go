package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Addr                string
	BaseURL             string
	DiscordClientID     string
	DiscordClientSecret string
	DBPath              string
	DataDir             string
	StaticDir           string
	CookieSecure        bool
	MockAuth            bool
}

func Load() Config {
	baseURL := envString("TSIAN_BASE_URL", "http://localhost:8080")
	return Config{
		Addr:                envString("TSIAN_ADDR", ":8080"),
		BaseURL:             strings.TrimRight(baseURL, "/"),
		DiscordClientID:     os.Getenv("TSIAN_DISCORD_CLIENT_ID"),
		DiscordClientSecret: os.Getenv("TSIAN_DISCORD_CLIENT_SECRET"),
		DBPath:              envString("TSIAN_DB_PATH", "data/tsian.db"),
		DataDir:             envString("TSIAN_DATA_DIR", "data"),
		StaticDir:           envString("TSIAN_STATIC_DIR", "../platform-web/dist"),
		CookieSecure:        envBool("TSIAN_COOKIE_SECURE", strings.HasPrefix(baseURL, "https://")),
		MockAuth:            envBool("TSIAN_MOCK_AUTH", false),
	}
}

func envString(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
