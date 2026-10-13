package mcpserver

import (
	"crypto/sha256"
	"encoding/base64"
	"html/template"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"demo-site/backend/internal/authn"
)

type browserFlow struct {
	CookieHash        string
	Expires           time.Time
	Grant             *authn.Grant
	State, ClientName string
}
type Portal struct {
	MCP   *Handler
	mu    sync.Mutex
	flows map[string]browserFlow
}
type portalView struct {
	MCPURL, Action, Nonce, Token, Expires, Message, Workspace, ClientName, Redirect, Scopes string
	CanReset, OAuth, PublicDemoLogin                                                        bool
	CSS                                                                                     template.CSS
}

func NewPortal(h *Handler) *Portal { return &Portal{MCP: h, flows: map[string]browserFlow{}} }

const portalCSS = `:root{color-scheme:light dark;font:16px/1.6 system-ui,sans-serif;background:light-dark(#f4f6fa,#111827);color:light-dark(#172033,#e5e7eb)}body{margin:0;padding:32px 16px}main{max-width:780px;margin:auto;padding:32px;border:1px solid light-dark(#d9e0ec,#374151);border-radius:16px;background:light-dark(#fff,#1f2937)}h1{margin:0 0 16px;font-size:28px}h2{font-size:20px}p{overflow-wrap:anywhere}input:not([type=checkbox]),textarea{box-sizing:border-box;width:100%;padding:12px;border:1px solid light-dark(#b9c4d8,#64748b);border-radius:8px;font:14px/1.5 ui-monospace,monospace;background:light-dark(#f8fafc,#111827);color:inherit}button{padding:10px 18px;border:1px solid #4265d6;border-radius:8px;background:#3159d1;color:#fff;font:inherit;cursor:pointer}a{color:light-dark(#3159d1,#a5b4fc)}[role=status]{padding:12px;background:light-dark(#eef3ff,#28334d);border-radius:8px}input[type=checkbox]{width:18px;height:18px;vertical-align:middle}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #819cf0;outline-offset:3px}@media(max-width:600px){main{padding:20px}body{padding:16px 8px}h1{font-size:24px}}`

var portalTemplate = template.Must(template.New("portal").Parse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MCP 连接 · demo-site</title><style>{{.CSS}}</style></head>
<body><main><h1>MCP 连接</h1><p>演示账号登录后获取 Access Token，用于验证 MCP 连接与工具调用。</p>
{{if .Message}}<p role="status">{{.Message}}</p>{{end}}
<p><label>MCP 地址 <input readonly value="{{.MCPURL}}"></label></p>
{{if .Token}}<h2>Access Token</h2><p>复制到客户端的 Bearer Token 配置。令牌只在此页展示。</p>
<textarea readonly aria-label="Access Token" rows="3" spellcheck="false">{{.Token}}</textarea><p>到期时间：{{.Expires}}</p><p>演示空间：{{.Workspace}}</p>
{{else if .Nonce}}
{{if .OAuth}}<p>客户端：<strong>{{.ClientName}}</strong></p><p>返回地址：{{.Redirect}}</p><p>申请权限：{{.Scopes}}</p><p>只授权你正在配置的客户端。</p>{{end}}
{{if .PublicDemoLogin}}<p role="note" aria-label="演示登录信息">公开演示账号：用户名 <strong>demo</strong>，密码 <strong>demo</strong>。</p>{{end}}
<form method="post" action="{{.Action}}"><input type="hidden" name="nonce" value="{{.Nonce}}">
<p><label>用户名 <input name="username" autocomplete="username" value="demo" required maxlength="128"></label></p>
<p><label>密码 <input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label></p>
{{if .CanReset}}{{if not .OAuth}}<p><label><input type="checkbox" name="reset" value="yes">允许重置演示数据</label></p>{{end}}{{end}}
<button type="submit">{{if .OAuth}}登录并授权{{else}}获取 Access Token{{end}}</button>
{{if .OAuth}}<button type="submit" name="deny" value="yes" formnovalidate>取消授权</button>{{end}}</form>
{{end}}
{{if .Nonce}}{{if not .OAuth}}<form method="post" action="/api/v1/mcp/connect/disconnect"><input type="hidden" name="nonce" value="{{.Nonce}}"><p><button type="submit">撤销此账号的全部 MCP Token</button></p></form>{{end}}{{end}}
<p>同一 demo 账号共用一个演示空间。令牌一小时有效，过期后重新登录。</p><p><a href="/api/v1/mcp/connect">重新登录</a> · <a href="/">返回应用</a></p></main></body></html>`))

func browserCookie(r *http.Request) string {
	c, err := r.Cookie("awcp_demo")
	if err != nil || len(c.Value) != 64 {
		return ""
	}
	return c.Value
}
func (p *Portal) cookie(w http.ResponseWriter, secret string) {
	http.SetCookie(w, &http.Cookie{Name: "awcp_demo", Value: secret, Path: "/api", MaxAge: 7 * 24 * 60 * 60, HttpOnly: true, Secure: strings.HasPrefix(p.MCP.Config.PublicURL, "https://"), SameSite: http.SameSiteLaxMode})
}
func (p *Portal) put(f browserFlow) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	for k, v := range p.flows {
		if !v.Expires.After(time.Now()) {
			delete(p.flows, k)
		}
	}
	if len(p.flows) >= 1024 {
		return ""
	}
	key := authn.Secret()
	p.flows[key] = f
	return key
}
func (p *Portal) take(key, cookie string) (browserFlow, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	f, ok := p.flows[key]
	if !ok || cookie == "" || f.CookieHash != authn.Hash(cookie) || !f.Expires.After(time.Now()) {
		return browserFlow{}, false
	}
	delete(p.flows, key)
	return f, true
}
func (p *Portal) page(w http.ResponseWriter, status int, v portalView) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	// no-referrer turns a browser form POST's Origin into "null". Keep the
	// same-origin Origin for CSRF checks while omitting cross-origin referrers.
	w.Header().Set("Referrer-Policy", "same-origin")
	style := sha256.Sum256([]byte(portalCSS))
	formActions := "'self'"
	if v.OAuth {
		// Chromium checks form redirects against form-action as well. The
		// callback was validated against this client's registered redirect URIs.
		if callback, err := url.Parse(v.Redirect); err == nil {
			source := (&url.URL{Scheme: callback.Scheme, Host: callback.Host}).String()
			formActions += " " + strings.NewReplacer(";", "%3B", "'", "%27").Replace(source)
		}
	}
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'sha256-"+base64.StdEncoding.EncodeToString(style[:])+"'; form-action "+formActions+"; frame-ancestors 'none'; base-uri 'none'")
	v.MCPURL = p.MCP.Config.PublicURL
	v.CanReset = p.MCP.Config.EnableReset
	v.PublicDemoLogin = p.MCP.Config.PublicDemoLogin
	v.CSS = template.CSS(portalCSS)
	v.Action = "/api/v1/mcp/connect/start"
	if v.OAuth {
		v.Action = "/api/v1/mcp/oauth/authorize"
	}
	w.WriteHeader(status)
	_ = portalTemplate.Execute(w, v)
}
func (p *Portal) index(w http.ResponseWriter, r *http.Request, f browserFlow) {
	_, cookie, err := p.MCP.Sessions.Bootstrap(r.Context(), browserCookie(r))
	if err != nil {
		p.page(w, 503, portalView{Message: "无法建立会话。"})
		return
	}
	if cookie == "" {
		cookie = browserCookie(r)
	}
	p.cookie(w, cookie)
	f.CookieHash = authn.Hash(cookie)
	f.Expires = time.Now().Add(5 * time.Minute)
	nonce := p.put(f)
	if nonce == "" {
		p.page(w, 429, portalView{Message: "请求较多，请稍后重试。"})
		return
	}
	v := portalView{Nonce: nonce}
	if f.Grant != nil {
		v.OAuth = true
		v.ClientName = f.ClientName
		v.Redirect = f.Grant.RedirectURI
		v.Scopes = f.Grant.Scope
	}
	p.page(w, 200, v)
}
func (p *Portal) Index(w http.ResponseWriter, r *http.Request) { p.index(w, r, browserFlow{}) }
func (p *Portal) form(w http.ResponseWriter, r *http.Request) (browserFlow, bool) {
	if r.Header.Get("Origin") != p.MCP.Config.BaseURL() {
		p.page(w, 403, portalView{Message: "请求来源无效。"})
		return browserFlow{}, false
	}
	if !parseOAuthForm(w, r) {
		return browserFlow{}, false
	}
	f, ok := p.take(r.PostForm.Get("nonce"), browserCookie(r))
	if !ok {
		p.page(w, 400, portalView{Message: "页面已过期，请重新登录。"})
	}
	return f, ok
}
func (p *Portal) Start(w http.ResponseWriter, r *http.Request) { p.login(w, r, false) }
func (p *Portal) login(w http.ResponseWriter, r *http.Request, oauth bool) {
	if !p.MCP.allow(p.MCP.Auth.Principal("login", "")) {
		p.page(w, 429, portalView{Message: "登录请求较多，请稍后重试。"})
		return
	}
	f, ok := p.form(w, r)
	if !ok {
		return
	}
	if (f.Grant != nil) != oauth {
		p.page(w, 400, portalView{Message: "登录请求不匹配。"})
		return
	}
	if oauth && r.PostForm.Get("deny") == "yes" {
		p.redirect(w, r, f, "", "access_denied")
		return
	}
	if !p.MCP.Auth.Login(r.PostForm.Get("username"), r.PostForm.Get("password")) {
		p.page(w, 401, portalView{Message: "用户名或密码错误，请重新登录。"})
		return
	}
	client, scope := "demo-portal", strings.Join(p.MCP.DefaultScopes(), " ")
	if oauth {
		client = f.Grant.ClientID
		scope = f.Grant.Scope
	} else if p.MCP.Config.EnableReset && r.PostForm.Get("reset") == "yes" {
		scope += " demo:reset"
	}
	view, cookie, err := p.MCP.Sessions.ConnectMCP(r.Context(), browserCookie(r), p.MCP.Auth.Principal(client, scope))
	if err != nil {
		p.page(w, 409, portalView{Message: "无法关联演示空间，请重新打开连接页。"})
		return
	}
	p.cookie(w, cookie)
	if oauth {
		code, err := p.MCP.Auth.Code(r.Context(), *f.Grant)
		if err != nil {
			p.page(w, 503, portalView{Message: "无法完成授权。"})
			return
		}
		p.redirect(w, r, f, code, "")
		return
	}
	token, exp, err := p.MCP.Auth.Issue(r.Context(), client, scope)
	if err != nil {
		p.page(w, 503, portalView{Message: "无法签发令牌。"})
		return
	}
	nonce := p.put(browserFlow{CookieHash: authn.Hash(cookie), Expires: time.Now().Add(5 * time.Minute)})
	p.page(w, 200, portalView{Token: token, Expires: exp.UTC().Format(time.RFC3339), Nonce: nonce, Workspace: view.ID})
}
func (p *Portal) redirect(w http.ResponseWriter, r *http.Request, f browserFlow, code, failure string) {
	u, _ := url.Parse(f.Grant.RedirectURI)
	q := u.Query()
	q.Set("state", f.State)
	q.Set("iss", p.MCP.Config.Issuer)
	if failure != "" {
		q.Set("error", failure)
	} else {
		q.Set("code", code)
	}
	u.RawQuery = q.Encode()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, u.String(), 303)
}
func (p *Portal) Disconnect(w http.ResponseWriter, r *http.Request) {
	f, ok := p.form(w, r)
	if !ok {
		return
	}
	if f.Grant != nil {
		p.page(w, 400, portalView{Message: "表单无效。"})
		return
	}
	// A browser must already own the linked space before it can revoke this demo account.
	if err := p.MCP.Sessions.DisconnectMCP(r.Context(), browserCookie(r)); err != nil {
		p.page(w, 403, portalView{Message: "当前浏览器没有关联授权。"})
		return
	}
	p.page(w, 200, portalView{Message: "已撤销此账号的全部 MCP Token 并断开空间授权。"})
}
