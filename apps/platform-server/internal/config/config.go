package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Addr                       string
	BaseURL                    string
	DiscordClientID            string
	DiscordClientSecret        string
	DiscordRegistrationGuildID string
	DiscordRegistrationRoleIDs []string
	DBPath                     string
	DataDir                    string
	StaticDir                  string
	CookieSecure               bool
	MockAuth                   bool
}

func Load() Config {
	baseURL := envString("TSIAN_BASE_URL", "http://localhost:8080")
	return Config{
		Addr:                       envString("TSIAN_ADDR", ":8080"),
		BaseURL:                    strings.TrimRight(baseURL, "/"),
		DiscordClientID:            os.Getenv("TSIAN_DISCORD_CLIENT_ID"),
		DiscordClientSecret:        os.Getenv("TSIAN_DISCORD_CLIENT_SECRET"),
		DiscordRegistrationGuildID: envString("TSIAN_DISCORD_REGISTRATION_GUILD_ID", ""),
		DiscordRegistrationRoleIDs: envList("TSIAN_DISCORD_REGISTRATION_ROLE_IDS"),
		DBPath:                     envString("TSIAN_DB_PATH", "data/tsian.db"),
		DataDir:                    envString("TSIAN_DATA_DIR", "data"),
		StaticDir:                  envString("TSIAN_STATIC_DIR", "../platform-web/dist"),
		CookieSecure:               envBool("TSIAN_COOKIE_SECURE", strings.HasPrefix(baseURL, "https://")),
		MockAuth:                   envBool("TSIAN_MOCK_AUTH", false),
	}
}

func (c Config) DiscordRegistrationGateEnabled() bool {
	hasGuild := c.DiscordRegistrationGuildID != ""
	hasRoles := len(c.DiscordRegistrationRoleIDs) > 0
	return hasGuild && hasRoles
}

func (c Config) DiscordRegistrationGateMisconfigured() bool {
	hasGuild := c.DiscordRegistrationGuildID != ""
	hasRoles := len(c.DiscordRegistrationRoleIDs) > 0
	return hasGuild != hasRoles
}

func envString(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func envList(key string) []string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return nil
	}

	parts := strings.Split(value, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item != "" {
			items = append(items, item)
		}
	}
	return items
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
