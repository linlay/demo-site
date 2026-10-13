package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"demo-site/backend/internal/config"
	"demo-site/backend/internal/mcpserver"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"demo-site/backend/internal/service"
)

const cookieName = "awcp_demo"

var cookiePattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Server struct {
	Sessions *service.Sessions
	Config   config.Config
	Logger   *slog.Logger
}

func New(sessions *service.Sessions, c config.Config, logger *slog.Logger) http.Handler {
	s := &Server{Sessions: sessions, Config: c, Logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /api/v1/session", s.session)
	mux.HandleFunc("GET /api/v1/settings/awcp", s.awcpSettings)
	mux.HandleFunc("POST /api/v1/settings/awcp", s.updateAWCPSettings)
	mux.HandleFunc("GET /api/v1/events", s.events)
	mux.HandleFunc("POST /api/v1/session/reset", s.reset)
	mux.HandleFunc("POST /api/v1/reports/query", s.report)
	mux.HandleFunc("POST /api/v1/business/{operation}", s.business)
	mux.HandleFunc("POST /api/v1/business/{operation}/{validation}", s.business)
	if c.MCP.Enabled {
		mcpHandler := mcpserver.New(c.MCP, c.Origins, sessions, logger)
		portal := mcpserver.NewPortal(mcpHandler)
		mux.Handle("/mcp", mcpHandler)
		mux.HandleFunc("/.well-known/oauth-protected-resource", mcpHandler.Metadata)
		mux.HandleFunc("/.well-known/oauth-protected-resource/mcp", mcpHandler.Metadata)
		mux.HandleFunc("GET /api/v1/mcp/connect", portal.Index)
		mux.HandleFunc("POST /api/v1/mcp/connect/start", portal.Start)
		mux.HandleFunc("GET /.well-known/oauth-authorization-server", mcpHandler.AuthorizationMetadata)
		mux.HandleFunc("GET /api/v1/mcp/oauth/authorize", portal.Authorize)
		mux.HandleFunc("POST /api/v1/mcp/oauth/authorize", portal.Authorize)
		mux.HandleFunc("/oauth/register", mcpHandler.OAuthEndpoint(mcpHandler.Register))
		mux.HandleFunc("/oauth/token", mcpHandler.OAuthEndpoint(mcpHandler.Token))
		mux.HandleFunc("/oauth/revoke", mcpHandler.OAuthEndpoint(mcpHandler.Revoke))
		mux.HandleFunc("POST /api/v1/mcp/connect/disconnect", portal.Disconnect)
	}
	mux.HandleFunc("/", s.static)
	return s.protect(mux)
}
func (s *Server) protect(next http.Handler) http.Handler {
	origins := map[string]bool{}
	for _, origin := range s.Config.Origins {
		origins[origin] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
			origin := r.Header.Get("Origin")
			unsafe := r.Method != "GET" && r.Method != "HEAD"
			// External clients navigate here for login. Grant validation precedes
			// the form; POST still requires same-origin and a cookie-bound nonce.
			callback := s.Config.MCP.Enabled && r.Method == "GET" && r.URL.Path == "/api/v1/mcp/oauth/authorize"
			if !callback && (r.Header.Get("Sec-Fetch-Site") == "cross-site" || origin != "" && !origins[origin] || unsafe && !origins[origin]) {
				s.fail(w, r, model.Failure(403, "request.origin", "请求来源不被允许。"))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func token(r *http.Request) string {
	cookie, err := r.Cookie(cookieName)
	if err != nil || !cookiePattern.MatchString(cookie.Value) {
		return ""
	}
	return cookie.Value
}
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	view, secret, err := s.Sessions.Bootstrap(r.Context(), token(r))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if secret == "" {
		secret = token(r)
	}
	s.renewCookie(w, secret)
	view.MCPAvailable = s.Config.MCP.Enabled
	if s.Config.MCP.Enabled {
		view.MCPConnectURL = s.Config.MCP.ConnectURL()
	}
	respond(w, 200, view)
}
func (s *Server) reset(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RequestID string `json:"requestId"`
	}
	if err := decode(w, r, &input); err != nil {
		s.fail(w, r, err)
		return
	}
	view, err := s.Sessions.Reset(r.Context(), token(r), r.Header.Get("X-Demo-Generation"), input.RequestID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.renewCookie(w, token(r))
	view.MCPAvailable = s.Config.MCP.Enabled
	if s.Config.MCP.Enabled {
		view.MCPConnectURL = s.Config.MCP.ConnectURL()
	}
	respond(w, 200, view)
}
func (s *Server) report(w http.ResponseWriter, r *http.Request) {
	input := model.ReportFilter{GroupBy: "month", Page: 1, PageSize: 20}
	if err := decode(w, r, &input); err != nil {
		s.fail(w, r, err)
		return
	}
	view, err := s.Sessions.Report(r.Context(), token(r), r.Header.Get("X-Demo-Generation"), input)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.renewCookie(w, token(r))
	respond(w, 200, view)
}
func (s *Server) renewCookie(w http.ResponseWriter, secret string) {
	if secret != "" {
		http.SetCookie(w, &http.Cookie{Name: cookieName, Value: secret, Path: "/api", MaxAge: int(repository.SessionLifetime.Seconds()), HttpOnly: true, Secure: s.Config.SecureCookie, SameSite: http.SameSiteLaxMode})
	}
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if err := s.Sessions.Store.DB.PingContext(r.Context()); err != nil {
		respond(w, 503, map[string]string{"status": "unavailable"})
		return
	}
	respond(w, 200, map[string]string{"status": "ok", "datasetVersion": repository.DatasetVersion})
}
func decode(w http.ResponseWriter, r *http.Request, destination any) error {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return model.Failure(415, "request.content-type", "请使用 application/json。")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	var raw json.RawMessage
	if err = decoder.Decode(&raw); err != nil || len(bytes.TrimSpace(raw)) == 0 || bytes.TrimSpace(raw)[0] != '{' {
		return model.Failure(400, "request.invalid-json", "请求必须是 JSON 对象。")
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil {
		return model.Failure(400, "request.invalid-json", "请求 JSON 无效。")
	}
	for field, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) && !(field == "requestId" && strings.HasPrefix(r.URL.Path, "/api/v1/business/approval_submit")) {
			return model.Invalid(field, "字段不能为 null；未筛选的文本字段请传空字符串。")
		}
	}
	object := json.NewDecoder(bytes.NewReader(raw))
	object.DisallowUnknownFields()
	if err = object.Decode(destination); err != nil {
		return model.Failure(400, "request.invalid-json", "请求 JSON 无效、包含未知字段或超出大小限制。")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return model.Failure(400, "request.invalid-json", "请求必须只包含一个 JSON 对象。")
	}
	return nil
}
func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	var failure *model.Error
	if !errors.As(err, &failure) {
		s.Logger.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
		failure = model.Failure(500, "server.internal", "服务暂时无法完成请求，请重试。")
	}
	respond(w, failure.Status, failure)
}

var scenePath = regexp.MustCompile(`^/scenes/(O(0[1-9]|1[0-6])|S0[1-5]|P(0[1-9]|10))(/(objects/[^/]+|new(/[^/]+)?))?/?$`)

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		s.fail(w, r, model.Failure(404, "request.not-found", "接口不存在。"))
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", 405)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		// No SPA fallback for missing chunks. FileServer handles traversal and MIME types.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.FileServer(http.Dir(s.Config.StaticDir)).ServeHTTP(w, r)
		return
	}
	if r.URL.Path != "/" && r.URL.Path != "/analysis" && r.URL.Path != "/navigation" && !scenePath.MatchString(r.URL.Path) {
		http.NotFound(w, r)
		return
	}
	index := filepath.Join(s.Config.StaticDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		http.Error(w, "Frontend build unavailable", 503)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, index)
}
