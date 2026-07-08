package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"tsian/platform-server/internal/config"
	"tsian/platform-server/internal/user"
)

const discordAPIBase = "https://discord.com/api"

type DiscordClient struct {
	cfg        config.Config
	httpClient *http.Client
}

type discordTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
}

type discordUserResponse struct {
	ID       string  `json:"id"`
	Username string  `json:"username"`
	Avatar   *string `json:"avatar"`
}

type discordGuildMemberResponse struct {
	Roles []string `json:"roles"`
}

func NewDiscordClient(cfg config.Config) *DiscordClient {
	return &DiscordClient{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (c *DiscordClient) AuthorizeURL(state string) string {
	values := url.Values{}
	values.Set("client_id", c.cfg.DiscordClientID)
	values.Set("redirect_uri", c.callbackURL())
	values.Set("response_type", "code")
	values.Set("scope", strings.Join(c.scopes(), " "))
	values.Set("state", state)
	return "https://discord.com/oauth2/authorize?" + values.Encode()
}

func (c *DiscordClient) Exchange(ctx context.Context, code string) (string, error) {
	values := url.Values{}
	values.Set("client_id", c.cfg.DiscordClientID)
	values.Set("client_secret", c.cfg.DiscordClientSecret)
	values.Set("grant_type", "authorization_code")
	values.Set("code", code)
	values.Set("redirect_uri", c.callbackURL())

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, discordAPIBase+"/oauth2/token", strings.NewReader(values.Encode()))
	if err != nil {
		return "", fmt.Errorf("build discord token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("exchange discord token: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("exchange discord token: status %d", res.StatusCode)
	}

	var body discordTokenResponse
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("decode discord token response: %w", err)
	}
	if body.AccessToken == "" {
		return "", fmt.Errorf("discord token response missing access_token")
	}
	return body.AccessToken, nil
}

func (c *DiscordClient) FetchMe(ctx context.Context, accessToken string) (user.DiscordIdentity, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discordAPIBase+"/users/@me", nil)
	if err != nil {
		return user.DiscordIdentity{}, fmt.Errorf("build discord me request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return user.DiscordIdentity{}, fmt.Errorf("fetch discord me: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return user.DiscordIdentity{}, fmt.Errorf("fetch discord me: status %d", res.StatusCode)
	}

	var body discordUserResponse
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return user.DiscordIdentity{}, fmt.Errorf("decode discord me response: %w", err)
	}
	if body.ID == "" || body.Username == "" {
		return user.DiscordIdentity{}, fmt.Errorf("discord me response missing id or username")
	}
	return user.DiscordIdentity{
		DiscordID: body.ID,
		Username:  body.Username,
		AvatarURL: discordAvatarURL(body.ID, body.Avatar),
	}, nil
}

func (c *DiscordClient) RegistrationAllowed(ctx context.Context, accessToken string) (bool, error) {
	if !c.cfg.DiscordRegistrationGateEnabled() {
		return true, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discordAPIBase+"/users/@me/guilds/"+url.PathEscape(c.cfg.DiscordRegistrationGuildID)+"/member", nil)
	if err != nil {
		return false, fmt.Errorf("build discord guild member request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("fetch discord guild member: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return false, fmt.Errorf("fetch discord guild member: status %d", res.StatusCode)
	}

	var body discordGuildMemberResponse
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return false, fmt.Errorf("decode discord guild member response: %w", err)
	}
	return hasAllowedRole(body.Roles, c.cfg.DiscordRegistrationRoleIDs), nil
}

func (c *DiscordClient) callbackURL() string {
	return c.cfg.BaseURL + "/api/v1/auth/callback"
}

func (c *DiscordClient) scopes() []string {
	scopes := []string{"identify"}
	if c.cfg.DiscordRegistrationGateEnabled() {
		scopes = append(scopes, "guilds.members.read")
	}
	return scopes
}

func hasAllowedRole(memberRoles []string, allowedRoleIDs []string) bool {
	allowed := make(map[string]struct{}, len(allowedRoleIDs))
	for _, roleID := range allowedRoleIDs {
		allowed[roleID] = struct{}{}
	}
	for _, roleID := range memberRoles {
		if _, ok := allowed[roleID]; ok {
			return true
		}
	}
	return false
}

func discordAvatarURL(discordID string, avatar *string) *string {
	if avatar == nil || *avatar == "" {
		return nil
	}
	url := fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.png", discordID, *avatar)
	return &url
}
