package mcpserver

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"demo-site/backend/internal/authn"
)

func oauthJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func oauthError(w http.ResponseWriter, status int, code string) {
	oauthJSON(w, status, map[string]string{"error": code})
}
func parseOAuthForm(w http.ResponseWriter, r *http.Request) bool {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/x-www-form-urlencoded" {
		oauthError(w, 400, "invalid_request")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if r.ParseForm() != nil || r.URL.RawQuery != "" {
		oauthError(w, 400, "invalid_request")
		return false
	}
	for _, v := range r.PostForm {
		if len(v) != 1 {
			oauthError(w, 400, "invalid_request")
			return false
		}
	}
	return true
}
func (h *Handler) AuthorizationMetadata(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	oauthJSON(w, 200, map[string]any{"issuer": h.Config.Issuer, "authorization_endpoint": h.Config.AuthorizationURL(), "token_endpoint": h.Config.TokenURL(), "registration_endpoint": h.Config.BaseURL() + "/oauth/register", "revocation_endpoint": h.Config.BaseURL() + "/oauth/revoke", "response_types_supported": []string{"code"}, "grant_types_supported": []string{"authorization_code"}, "token_endpoint_auth_methods_supported": []string{"none"}, "revocation_endpoint_auth_methods_supported": []string{"none"}, "code_challenge_methods_supported": []string{"S256"}, "scopes_supported": h.Scopes(), "authorization_response_iss_parameter_supported": true})
}

// Public OAuth endpoints never use cookies. Wildcard CORS permits browser MCP
// clients; no Access-Control-Allow-Credentials is sent.
func (h *Handler) OAuthEndpoint(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		if r.Method != "POST" {
			w.Header().Set("Allow", "POST, OPTIONS")
			oauthError(w, 405, "invalid_request")
			return
		}
		if !h.allow(h.Auth.Principal("oauth-endpoint", "")) {
			w.Header().Set("Retry-After", "60")
			oauthError(w, 429, "temporarily_unavailable")
			return
		}
		if r.Header.Get("Authorization") != "" {
			oauthError(w, 401, "invalid_client")
			return
		}
		next(w, r)
	}
}
func validRedirect(raw string) bool {
	if len(raw) > 2048 || strings.ContainsAny(raw, "#*") {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || strings.ContainsAny(raw, "\r\n\\") {
		return false
	}
	local := u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return false
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return false
	}
	for _, key := range []string{"code", "state", "iss", "error"} {
		if q.Has(key) {
			return false
		}
	}
	return true
}
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if media != "application/json" {
		oauthError(w, 400, "invalid_client_metadata")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	var in struct {
		Name          string   `json:"client_name"`
		Redirects     []string `json:"redirect_uris"`
		GrantTypes    []string `json:"grant_types"`
		ResponseTypes []string `json:"response_types"`
		AuthMethod    string   `json:"token_endpoint_auth_method"`
	}
	d := json.NewDecoder(r.Body)
	if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF || len(in.Name) > 128 || len(in.Redirects) < 1 || len(in.Redirects) > 8 || in.AuthMethod != "none" {
		oauthError(w, 400, "invalid_client_metadata")
		return
	}
	for _, v := range in.GrantTypes {
		if v != "authorization_code" {
			oauthError(w, 400, "invalid_client_metadata")
			return
		}
	}
	for _, v := range in.ResponseTypes {
		if v != "code" {
			oauthError(w, 400, "invalid_client_metadata")
			return
		}
	}
	for _, v := range in.Redirects {
		if !validRedirect(v) {
			oauthError(w, 400, "invalid_redirect_uri")
			return
		}
	}
	if in.Name == "" {
		in.Name = "MCP client"
	}
	c, err := h.Auth.Register(r.Context(), in.Name, in.Redirects)
	if err != nil {
		oauthError(w, 503, "temporarily_unavailable")
		return
	}
	oauthJSON(w, 201, map[string]any{"client_id": c.ID, "client_name": c.Name, "redirect_uris": c.Redirects, "grant_types": []string{"authorization_code"}, "response_types": []string{"code"}, "token_endpoint_auth_method": "none"})
}
func (p *Portal) Authorize(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		p.login(w, r, true)
		return
	}
	if !p.MCP.allow(p.MCP.Auth.Principal("authorize-page", "")) {
		oauthError(w, 429, "temporarily_unavailable")
		return
	}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(r.URL.RawQuery) > 8192 {
		oauthError(w, 400, "invalid_request")
		return
	}
	for _, v := range q {
		if len(v) != 1 {
			oauthError(w, 400, "invalid_request")
			return
		}
	}
	client, err := p.MCP.Auth.Client(r.Context(), q.Get("client_id"))
	if err != nil {
		oauthError(w, 400, "invalid_client")
		return
	}
	// Never redirect on invalid client/redirect; external URLs must be pre-registered.
	if !slices.Contains(client.Redirects, q.Get("redirect_uri")) {
		oauthError(w, 400, "invalid_request")
		return
	}
	if q.Get("response_type") != "code" || q.Get("code_challenge_method") != "S256" || q.Get("resource") != p.MCP.Config.PublicURL || q.Get("state") == "" || len(q.Get("state")) > 512 {
		oauthError(w, 400, "invalid_request")
		return
	}
	challenge, err := base64.RawURLEncoding.DecodeString(q.Get("code_challenge"))
	if err != nil || len(challenge) != 32 || base64.RawURLEncoding.EncodeToString(challenge) != q.Get("code_challenge") {
		oauthError(w, 400, "invalid_request")
		return
	}
	scope := q.Get("scope")
	if scope == "" {
		scope = strings.Join(p.MCP.DefaultScopes(), " ")
	}
	scopes := strings.Fields(scope)
	if !slices.Contains(scopes, "context:read") {
		oauthError(w, 400, "invalid_scope")
		return
	}
	for _, v := range scopes {
		if !slices.Contains(p.MCP.Scopes(), v) {
			oauthError(w, 400, "invalid_scope")
			return
		}
	}
	p.index(w, r, browserFlow{Grant: &authn.Grant{ClientID: client.ID, RedirectURI: q.Get("redirect_uri"), Challenge: q.Get("code_challenge"), Scope: strings.Join(scopes, " "), Resource: q.Get("resource")}, State: q.Get("state"), ClientName: client.Name})
}
func (h *Handler) Token(w http.ResponseWriter, r *http.Request) {
	if !parseOAuthForm(w, r) {
		return
	}
	f := r.PostForm
	if f.Get("grant_type") != "authorization_code" {
		oauthError(w, 400, "unsupported_grant_type")
		return
	}
	if f.Get("client_secret") != "" {
		oauthError(w, 401, "invalid_client")
		return
	}
	token, scope, err := h.Auth.Exchange(r.Context(), f.Get("code"), f.Get("client_id"), f.Get("redirect_uri"), f.Get("resource"), f.Get("code_verifier"))
	if errors.Is(err, authn.ErrInvalidGrant) {
		oauthError(w, 400, "invalid_grant")
		return
	}
	if err != nil {
		oauthError(w, 503, "temporarily_unavailable")
		return
	}
	oauthJSON(w, 200, map[string]any{"access_token": token, "token_type": "Bearer", "expires_in": int(authn.TokenLifetime.Seconds()), "scope": scope})
}
func (h *Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	if !parseOAuthForm(w, r) {
		return
	}
	if r.PostForm.Get("client_id") == "" || r.PostForm.Get("client_secret") != "" {
		oauthError(w, 400, "invalid_client")
		return
	}
	if err := h.Auth.Revoke(r.Context(), r.PostForm.Get("token"), r.PostForm.Get("client_id")); err != nil {
		oauthError(w, 503, "temporarily_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(200)
}
