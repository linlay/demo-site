package mcpserver_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"demo-site/backend/internal/authn"
	"demo-site/backend/internal/mcpserver"
)

var noncePattern = regexp.MustCompile(`name="nonce" value="([^"]+)"`)
var tokenPattern = regexp.MustCompile(`spellcheck="false">([^<]+)</textarea>`)

func request(method, path string, form url.Values, cookie *http.Cookie) *http.Request {
	r := httptest.NewRequest(method, "https://app.example"+path, strings.NewReader(form.Encode()))
	if method == "POST" {
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		r.Header.Set("Origin", "https://app.example")
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	return r
}
func nonce(t *testing.T, r *httptest.ResponseRecorder) string {
	t.Helper()
	m := noncePattern.FindStringSubmatch(r.Body.String())
	if len(m) != 2 {
		t.Fatalf("missing form: %d %s", r.Code, r.Body.String())
	}
	return m[1]
}
func portalLogin(t *testing.T, h *mcpserver.Handler, p *mcpserver.Portal) (string, *http.Cookie, string) {
	t.Helper()
	page := httptest.NewRecorder()
	p.Index(page, request("GET", "/api/v1/mcp/connect", nil, nil))
	cookie := page.Result().Cookies()[0]
	form := url.Values{"nonce": {nonce(t, page)}, "username": {h.Config.Username}, "password": {h.Config.Password}}
	result := httptest.NewRecorder()
	p.Start(result, request("POST", "/api/v1/mcp/connect/start", form, cookie))
	m := tokenPattern.FindStringSubmatch(result.Body.String())
	if result.Code != 200 || len(m) != 2 {
		t.Fatalf("login: %d %s", result.Code, result.Body.String())
	}
	return m[1], result.Result().Cookies()[0], nonce(t, result)
}
func TestDemoLoginRevocationAndCSRF(t *testing.T) {
	h, _, _ := setup(t)
	p := mcpserver.NewPortal(h)
	// An anonymous browser cannot revoke another browser's tokens.
	token, cookie, n := portalLogin(t, h, p)
	if _, _, err := h.Auth.Verify(context.Background(), token); err != nil {
		t.Fatal(err)
	}
	page := httptest.NewRecorder()
	p.Index(page, request("GET", "/api/v1/mcp/connect", nil, nil))
	revoke := httptest.NewRecorder()
	p.Disconnect(revoke, request("POST", "/api/v1/mcp/connect/disconnect", url.Values{"nonce": {nonce(t, page)}}, page.Result().Cookies()[0]))
	if revoke.Code != 403 {
		t.Fatalf("anonymous revoke: %d", revoke.Code)
	}
	if _, _, err := h.Auth.Verify(context.Background(), token); err != nil {
		t.Fatal("anonymous revocation succeeded")
	}
	bad := request("POST", "/api/v1/mcp/connect/disconnect", url.Values{"nonce": {n}}, cookie)
	bad.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	p.Disconnect(rec, bad)
	if rec.Code != 403 {
		t.Fatal("CSRF accepted")
	}
	rec = httptest.NewRecorder()
	p.Disconnect(rec, request("POST", "/api/v1/mcp/connect/disconnect", url.Values{"nonce": {n}}, cookie))
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if _, _, err := h.Auth.Verify(context.Background(), token); err != authn.ErrInvalidToken {
		t.Fatal("revoked token accepted")
	}
	// Incorrect credentials never produce a token.
	page = httptest.NewRecorder()
	p.Index(page, request("GET", "/api/v1/mcp/connect", nil, nil))
	rec = httptest.NewRecorder()
	p.Start(rec, request("POST", "/api/v1/mcp/connect/start", url.Values{"nonce": {nonce(t, page)}, "username": {"user-a"}, "password": {"wrong"}}, page.Result().Cookies()[0]))
	if rec.Code != 401 {
		t.Fatal("wrong password accepted")
	}
}
func register(t *testing.T, h *mcpserver.Handler) string {
	t.Helper()
	r := httptest.NewRequest("POST", "https://app.example/oauth/register", strings.NewReader(`{"client_name":"Test client","redirect_uris":["http://127.0.0.1:8989/callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"]}`))
	r.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.OAuthEndpoint(h.Register)(rec, r)
	var c authn.Client
	if rec.Code != 201 || json.Unmarshal(rec.Body.Bytes(), &c) != nil {
		t.Fatalf("register: %s", rec.Body.String())
	}
	return c.ID
}
func authorize(t *testing.T, h *mcpserver.Handler, p *mcpserver.Portal, client, verifier string) string {
	t.Helper()
	sum := sha256.Sum256([]byte(verifier))
	q := url.Values{"client_id": {client}, "response_type": {"code"}, "redirect_uri": {"http://127.0.0.1:8989/callback"}, "resource": {h.Config.PublicURL}, "scope": {"context:read reports:read"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"}, "state": {"client-state"}}
	page := httptest.NewRecorder()
	p.Authorize(page, request("GET", "/api/v1/mcp/oauth/authorize?"+q.Encode(), nil, nil))
	if strings.Contains(page.Body.String(), `aria-label="演示登录信息"`) != h.Config.PublicDemoLogin {
		t.Fatal("OAuth login credential visibility does not match demo mode")
	}
	n := nonce(t, page)
	cookie := page.Result().Cookies()[0]
	// The authorization form must belong to this browser.
	rejected := httptest.NewRecorder()
	p.Authorize(rejected, request("POST", "/api/v1/mcp/oauth/authorize", url.Values{"nonce": {n}, "username": {h.Config.Username}, "password": {h.Config.Password}}, nil))
	if rejected.Code != 400 {
		t.Fatal("unbound browser accepted")
	}
	rec := httptest.NewRecorder()
	p.Authorize(rec, request("POST", "/api/v1/mcp/oauth/authorize", url.Values{"nonce": {n}, "username": {h.Config.Username}, "password": {h.Config.Password}}, cookie))
	if rec.Code != 303 {
		t.Fatalf("authorize: %s", rec.Body.String())
	}
	u, _ := url.Parse(rec.Header().Get("Location"))
	if u.Query().Get("state") != "client-state" || u.Query().Get("iss") != h.Config.Issuer {
		t.Fatal("callback binding")
	}
	return u.Query().Get("code")
}
func exchange(h *mcpserver.Handler, client, code, verifier, resource string) *httptest.ResponseRecorder {
	form := url.Values{"grant_type": {"authorization_code"}, "client_id": {client}, "code": {code}, "code_verifier": {verifier}, "resource": {resource}, "redirect_uri": {"http://127.0.0.1:8989/callback"}}
	rec := httptest.NewRecorder()
	h.OAuthEndpoint(h.Token)(rec, request("POST", "/oauth/token", form, nil))
	return rec
}
func TestEmbeddedOAuthPKCEAudienceReplayExpiryAndPersistence(t *testing.T) {
	h, s, _ := setup(t)
	p := mcpserver.NewPortal(h)
	client := register(t, h)
	verifier := authn.Secret()
	code := authorize(t, h, p, client, verifier)
	for _, args := range [][3]string{{verifier, "https://evil.example/mcp", client}, {authn.Secret(), h.Config.PublicURL, client}, {verifier, h.Config.PublicURL, "other-client"}} {
		if rec := exchange(h, args[2], code, args[0], args[1]); rec.Code != 400 {
			t.Fatalf("bad exchange accepted: %s", rec.Body.String())
		}
	}
	rec := exchange(h, client, code, verifier, h.Config.PublicURL)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	var tokens map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &tokens)
	token := tokens["access_token"].(string)
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("token caching")
	}
	// Fresh verifier uses persistent SQLite rows; no in-memory token dependency.
	restarted := &authn.Local{DB: s.Store.DB, Config: h.Config}
	principal, _, err := restarted.Verify(context.Background(), token)
	if err != nil || principal.ClientID != client || !principal.HasScope("reports:read") {
		t.Fatal("persisted token verification", err)
	}
	changed := h.Config
	changed.Password = "rotated-password"
	if _, _, err = (&authn.Local{DB: s.Store.DB, Config: changed}).Verify(context.Background(), token); err != authn.ErrInvalidToken {
		t.Fatal("password rotation did not invalidate token")
	}
	restarted.Now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	if _, _, err = restarted.Verify(context.Background(), token); err != authn.ErrInvalidToken {
		t.Fatal("expired token accepted")
	}
	if rec = exchange(h, client, code, verifier, h.Config.PublicURL); rec.Code != 400 {
		t.Fatal("code replay accepted")
	}
	if _, _, err = h.Auth.Verify(context.Background(), token); err != authn.ErrInvalidToken {
		t.Fatal("replay did not revoke issued token")
	}
}
func TestOAuthRejectsUnsafeRedirectAndPasswordGrant(t *testing.T) {
	h, _, _ := setup(t)
	for _, uri := range []string{"http://public.example/cb", "https://*.example/cb", "javascript:alert(1)", "https://user:pass@example.com/cb", "https://example.com/cb#frag", "https://example.com/cb?code=x"} {
		body, _ := json.Marshal(map[string]any{"redirect_uris": []string{uri}, "token_endpoint_auth_method": "none"})
		r := httptest.NewRequest("POST", "https://app.example/oauth/register", strings.NewReader(string(body)))
		r.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.Register(rec, r)
		if rec.Code != 400 {
			t.Fatalf("accepted %s", uri)
		}
	}
	rec := httptest.NewRecorder()
	h.Token(rec, request("POST", "/oauth/token", url.Values{"grant_type": {"password"}}, nil))
	if rec.Code != 400 {
		t.Fatal("password grant accepted")
	}
	client := register(t, h)
	p := mcpserver.NewPortal(h)
	rec = httptest.NewRecorder()
	p.Authorize(rec, request("GET", "/api/v1/mcp/oauth/authorize?client_id="+client+"&redirect_uri=https://evil.example", nil, nil))
	if rec.Code != 400 || rec.Header().Get("Location") != "" {
		t.Fatal("open redirect")
	}
}

func TestPublicDemoCredentialsAndBothLoginFlows(t *testing.T) {
	for _, publicDemo := range []bool{false, true} {
		t.Run(map[bool]string{false: "private", true: "public-demo"}[publicDemo], func(t *testing.T) {
			h, _, _ := setup(t)
			if publicDemo {
				h.Config.Username, h.Config.Password = "demo", "demo"
				h.Config.PublicDemoLogin = true
				h.Auth.Config = h.Config
			}
			p := mcpserver.NewPortal(h)
			page := httptest.NewRecorder()
			p.Index(page, request("GET", "/api/v1/mcp/connect", nil, nil))
			if strings.Contains(page.Body.String(), `用户名 <strong>demo</strong>，密码 <strong>demo</strong>`) != publicDemo {
				t.Fatal("manual login credential visibility does not match demo mode")
			}
			if !publicDemo && strings.Contains(page.Body.String(), h.Config.Password) {
				t.Fatal("private password appeared on login page")
			}
			token, _, _ := portalLogin(t, h, p)
			if _, _, err := h.Auth.Verify(context.Background(), token); err != nil {
				t.Fatal("manual login token rejected", err)
			}
			client, verifier := register(t, h), authn.Secret()
			code := authorize(t, h, p, client, verifier)
			if result := exchange(h, client, code, verifier, h.Config.PublicURL); result.Code != 200 {
				t.Fatalf("OAuth token exchange: %d", result.Code)
			}
		})
	}
}

func TestOAuthDefaultBusinessScopesAndExplicitReadOnlyConsent(t *testing.T) {
	h, _, _ := setup(t)
	p := mcpserver.NewPortal(h)
	client := register(t, h)
	sum := sha256.Sum256([]byte(authn.Secret()))
	for _, scope := range []string{"", "context:read"} {
		q := url.Values{"client_id": {client}, "response_type": {"code"}, "redirect_uri": {"http://127.0.0.1:8989/callback"}, "resource": {h.Config.PublicURL}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"}, "state": {"scope-test"}}
		if scope != "" {
			q.Set("scope", scope)
		}
		rec := httptest.NewRecorder()
		p.Authorize(rec, request("GET", "/api/v1/mcp/oauth/authorize?"+q.Encode(), nil, nil))
		if rec.Code != 200 {
			t.Fatal(rec.Body.String())
		}
		body := rec.Body.String()
		if strings.Contains(body, "business:write") != (scope == "") {
			t.Fatal("consent changed explicit scope")
		}
		if strings.Contains(body, "demo:reset") {
			t.Fatal("destructive reset granted by default")
		}
	}
	challenge := call(t, h, "2026-07-28", "", "tools/list", "", nil)
	if !strings.Contains(challenge.Header().Get("WWW-Authenticate"), "business:write") {
		t.Fatal("challenge still requests context-only grant")
	}
}
