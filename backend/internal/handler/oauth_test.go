package handler_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"demo-site/backend/internal/config"
	"demo-site/backend/internal/handler"
	"demo-site/backend/internal/repository"
	"demo-site/backend/internal/service"
)

func TestMCPBrowserAuthorizationOriginAndReferrerPolicy(t *testing.T) {
	const base = "https://demo.example"
	const redirect = "http://127.0.0.1:8989/callback"
	store, err := repository.Open(context.Background(), filepath.Join(t.TempDir(), "oauth.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	c := config.Config{Origins: []string{base}, SecureCookie: true, MCP: config.MCP{Enabled: true, PublicURL: base + "/mcp", Issuer: base, Username: "demo", Password: "demo", PublicDemoLogin: true}}
	h := handler.New(&service.Sessions{Store: store, Profile: "acceptance"}, c, slog.New(slog.NewTextHandler(io.Discard, nil)))
	call := func(method, path, body, contentType, origin, fetchSite string, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, base+path, strings.NewReader(body))
		r.Header.Set("Content-Type", contentType)
		r.Header.Set("Origin", origin)
		r.Header.Set("Sec-Fetch-Site", fetchSite)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		h.ServeHTTP(response, r)
		return response
	}
	manual := call("GET", "/api/v1/mcp/connect", "", "", "", "none", nil)
	if manual.Code != 200 || manual.Header().Get("Referrer-Policy") != "same-origin" {
		t.Fatal("manual login page must preserve the form POST origin")
	}
	if !strings.Contains(manual.Header().Get("Content-Security-Policy"), "form-action 'self';") {
		t.Fatal("manual login must retain same-origin form restriction")
	}
	registered := call("POST", "/oauth/register", `{"client_name":"browser regression","redirect_uris":["`+redirect+`"],"token_endpoint_auth_method":"none"}`, "application/json", "", "", nil)
	var client struct {
		ID string `json:"client_id"`
	}
	if registered.Code != 201 || json.Unmarshal(registered.Body.Bytes(), &client) != nil || client.ID == "" {
		t.Fatalf("client registration: %d %s", registered.Code, registered.Body.String())
	}
	verifier := strings.Repeat("a", 43)
	sum := sha256.Sum256([]byte(verifier))
	query := url.Values{"client_id": {client.ID}, "response_type": {"code"}, "redirect_uri": {redirect}, "resource": {c.MCP.PublicURL}, "scope": {"context:read"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"}, "state": {"browser-state"}}
	page := call("GET", "/api/v1/mcp/oauth/authorize?"+query.Encode(), "", "", "https://desktop.example", "cross-site", nil)
	if page.Code != 200 || page.Header().Get("Referrer-Policy") != "same-origin" {
		t.Fatalf("external OAuth navigation: %d, policy %q", page.Code, page.Header().Get("Referrer-Policy"))
	}
	policy := page.Header().Get("Content-Security-Policy")
	if !strings.Contains(policy, "form-action 'self' http://127.0.0.1:8989;") || strings.Contains(policy, "https:") || strings.Contains(policy, "*") {
		t.Fatalf("OAuth form callback allowlist: %q", policy)
	}
	match := regexp.MustCompile(`name="nonce" value="([^"]+)"`).FindStringSubmatch(page.Body.String())
	if len(match) != 2 || len(page.Result().Cookies()) != 1 {
		t.Fatal("authorization form or browser binding missing")
	}
	cookie := page.Result().Cookies()[0]
	form := url.Values{"nonce": {match[1]}, "username": {"demo"}, "password": {"demo"}}.Encode()
	for _, origin := range []string{"", "null", "https://evil.example"} {
		rejected := call("POST", "/api/v1/mcp/oauth/authorize", form, "application/x-www-form-urlencoded", origin, "same-origin", cookie)
		if rejected.Code != 403 || !strings.Contains(rejected.Body.String(), "request.origin") {
			t.Fatalf("unsafe origin %q accepted: %d", origin, rejected.Code)
		}
	}
	crossSite := call("POST", "/api/v1/mcp/oauth/authorize", form, "application/x-www-form-urlencoded", base, "cross-site", cookie)
	if crossSite.Code != 403 {
		t.Fatal("cross-site form accepted")
	}
	unbound := call("POST", "/api/v1/mcp/oauth/authorize", form, "application/x-www-form-urlencoded", base, "same-origin", nil)
	if unbound.Code != 400 {
		t.Fatal("authorization form accepted without its browser cookie")
	}
	approved := call("POST", "/api/v1/mcp/oauth/authorize", form, "application/x-www-form-urlencoded", base, "same-origin", cookie)
	if approved.Code != 303 || approved.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("authorization: %d %s", approved.Code, approved.Body.String())
	}
	callback, err := url.Parse(approved.Header().Get("Location"))
	if err != nil || callback.Host != "127.0.0.1:8989" || callback.Path != "/callback" || callback.Query().Get("state") != "browser-state" || callback.Query().Get("iss") != base || callback.Query().Get("code") == "" {
		t.Fatal("OAuth callback binding failed")
	}
	replay := call("POST", "/api/v1/mcp/oauth/authorize", form, "application/x-www-form-urlencoded", base, "same-origin", cookie)
	if replay.Code != 400 {
		t.Fatal("authorization nonce replay accepted")
	}
	exchangeForm := url.Values{"grant_type": {"authorization_code"}, "client_id": {client.ID}, "code": {callback.Query().Get("code")}, "code_verifier": {verifier}, "resource": {c.MCP.PublicURL}, "redirect_uri": {redirect}}
	exchanged := call("POST", "/oauth/token", exchangeForm.Encode(), "application/x-www-form-urlencoded", "", "", nil)
	var token struct {
		Value string `json:"access_token"`
	}
	if exchanged.Code != 200 || json.Unmarshal(exchanged.Body.Bytes(), &token) != nil || token.Value == "" {
		t.Fatalf("PKCE token exchange: %d", exchanged.Code)
	}
	revoked := call("POST", "/oauth/revoke", url.Values{"token": {token.Value}, "client_id": {client.ID}}.Encode(), "application/x-www-form-urlencoded", "", "", nil)
	if revoked.Code != 200 {
		t.Fatal("diagnostic token revocation failed")
	}
}
