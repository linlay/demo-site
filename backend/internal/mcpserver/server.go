// Package mcpserver adapts authorized business services to the MCP transport.
package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"demo-site/backend/internal/authn"
	"demo-site/backend/internal/config"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// protocolImplementation is shared by every per-request, scope-filtered server.
var protocolImplementation = &mcp.Implementation{Name: "demo-site", Version: "0.2.0"}

type verifiedKey struct{}
type verified struct {
	Principal model.Principal
	Expiry    time.Time
}
type bucket struct {
	Start time.Time
	Count int
}
type TokenVerifier interface {
	Verify(context.Context, string) (model.Principal, time.Time, error)
}
type Handler struct {
	Config    config.MCP
	Sessions  *service.Sessions
	Verifier  TokenVerifier
	Auth      *authn.Local
	Logger    *slog.Logger
	origins   map[string]bool
	slots     chan struct{}
	mu        sync.Mutex
	buckets   map[string]bucket
	transport http.Handler
}

func New(c config.MCP, origins []string, s *service.Sessions, logger *slog.Logger) *Handler {
	limit := c.MaxConcurrent
	if limit < 1 {
		limit = 8
	}
	h := &Handler{Config: c, Sessions: s, Logger: logger, origins: map[string]bool{}, slots: make(chan struct{}, limit), buckets: map[string]bucket{}}
	for _, origin := range origins {
		h.origins[origin] = true
	}
	h.Auth = &authn.Local{DB: s.Store.DB, Config: c}
	h.Verifier = h.Auth
	h.transport = mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		identity, ok := r.Context().Value(verifiedKey{}).(verified)
		if !ok {
			return nil
		}
		return h.server(identity)
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, MaxRequestBodyBytes: 1 << 20, PropagateRequestCancellation: true, Logger: logger})
	return h
}

func (h *Handler) Scopes() []string {
	scopes := []string{"context:read", "directory:read", "reports:read"}
	if h.Config.EnableReset {
		scopes = append(scopes, "demo:reset")
	}
	return scopes
}

func (h *Handler) Metadata(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Cache-Control", "public, max-age=300")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD, OPTIONS")
		http.Error(w, "Method not allowed", 405)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"resource": h.Config.PublicURL, "resource_name": "demo-site MCP", "authorization_servers": []string{h.Config.Issuer}, "scopes_supported": h.Scopes(), "bearer_methods_supported": []string{"header"}})
}

func (h *Handler) challenge(w http.ResponseWriter, status int, code, scope string) {
	value := `Bearer resource_metadata="` + h.Config.MetadataURL() + `"`
	if code != "" {
		value += `, error="` + code + `"`
	}
	if scope != "" {
		value += `, scope="` + scope + `"`
	}
	w.Header().Set("WWW-Authenticate", value)
	http.Error(w, http.StatusText(status), status)
}

func (h *Handler) allow(p model.Principal) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	for key, b := range h.buckets {
		if now.Sub(b.Start) >= time.Minute {
			delete(h.buckets, key)
		}
	}
	key := p.Issuer + "\x00" + p.Subject + "\x00" + p.ClientID
	b, ok := h.buckets[key]
	if !ok {
		if len(h.buckets) >= 4096 {
			return false
		}
		b = bucket{Start: now}
	}
	if b.Count >= 60 {
		return false
	}
	b.Count++
	h.buckets[key] = b
	return true
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	public, _ := url.Parse(h.Config.PublicURL)
	if public == nil || !strings.EqualFold(r.Host, public.Host) {
		http.Error(w, "Untrusted host", 403)
		return
	}
	origin := r.Header.Get("Origin")
	if origin != "" && !h.origins[origin] {
		http.Error(w, "Untrusted origin", 403)
		return
	}
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Add("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, MCP-Method, MCP-Name, MCP-Client-Info, MCP-Client-Capabilities")
		w.Header().Set("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version, MCP-Session-Id, Retry-After")
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(204)
		return
	}
	if r.URL.RawQuery != "" {
		http.Error(w, "Query parameters are not supported", 400)
		return
	}
	select {
	case h.slots <- struct{}{}:
		defer func() { <-h.slots }()
	default:
		w.Header().Set("Retry-After", "2")
		http.Error(w, "Too many requests", 429)
		return
	}
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(r.Header.Values("Authorization")) != 1 || len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		h.challenge(w, 401, "", "context:read")
		return
	}
	p, expiry, err := h.Verifier.Verify(r.Context(), parts[1])
	if err != nil {
		if errors.Is(err, authn.ErrInvalidToken) {
			h.challenge(w, 401, "invalid_token", "")
		} else {
			http.Error(w, "Authorization service unavailable", 503)
		}
		return
	}
	if !p.HasScope("context:read") {
		h.challenge(w, 403, "insufficient_scope", "context:read")
		return
	}
	if !h.allow(p) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Too many requests", 429)
		return
	}
	if r.Method == http.MethodPost {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		body, readErr := io.ReadAll(r.Body)
		_ = r.Body.Close()
		if readErr != nil {
			http.Error(w, "Request body too large or unreadable", 413)
			return
		}
		var envelope struct {
			Method string `json:"method"`
			Params struct {
				Name string `json:"name"`
			} `json:"params"`
		}
		if json.Unmarshal(body, &envelope) == nil && envelope.Method == "tools/call" {
			if scope := toolScopes[envelope.Params.Name]; scope != "" && !p.HasScope(scope) {
				h.challenge(w, 403, "insufficient_scope", scope)
				return
			}
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	ctx = context.WithValue(ctx, verifiedKey{}, verified{Principal: p, Expiry: expiry})
	h.transport.ServeHTTP(w, r.WithContext(ctx))
}
