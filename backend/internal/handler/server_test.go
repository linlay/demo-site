package handler_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"demo-site/backend/internal/config"
	"demo-site/backend/internal/handler"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"demo-site/backend/internal/service"
)

func TestHTTPSessionOriginResetAndSPAFallback(t *testing.T) {
	dir := t.TempDir()
	static := filepath.Join(dir, "web")
	if err := os.Mkdir(static, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(static, "index.html"), []byte("<html>application</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	store, err := repository.Open(context.Background(), filepath.Join(dir, "demo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	h := handler.New(&service.Sessions{Store: store, Profile: "acceptance"}, config.Config{StaticDir: static, Origins: []string{"https://demo.example"}, SecureCookie: true}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	call := func(method, path, body, origin, generation string, cookie *http.Cookie) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		if generation != "" {
			request.Header.Set("X-Demo-Generation", generation)
		}
		if cookie != nil {
			request.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		h.ServeHTTP(response, request)
		return response
	}
	bootstrap := call("GET", "/api/v1/session", "", "", "", nil)
	if bootstrap.Code != 200 {
		t.Fatal(bootstrap.Body.String())
	}
	cookies := bootstrap.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteLaxMode || cookies[0].MaxAge <= 0 {
		t.Fatal("cookie attributes missing")
	}
	cookie := cookies[0]
	var view model.Session
	if err = json.Unmarshal(bootstrap.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(bootstrap.Body.String(), cookie.Value) {
		t.Fatal("token leaked in JSON")
	}
	for _, origin := range []string{"", "https://untrusted.example"} {
		response := call("POST", "/api/v1/session/reset", `{"requestId":"reset"}`, origin, view.Generation, cookie)
		if response.Code != 403 {
			t.Fatalf("origin accepted: %q %d", origin, response.Code)
		}
	}
	for _, body := range []string{`null`, `{"page":0}`, `{"pageSize":0}`, `{"groupBy":""}`, `{"from":null}`, `{"unknown":1}`, `{} {}`, `{"page": "one"}`} {
		response := call("POST", "/api/v1/reports/query", body, "https://demo.example", view.Generation, cookie)
		if response.Code != 400 {
			t.Fatalf("invalid body accepted: %s", body)
		}
	}
	reset := call("POST", "/api/v1/session/reset", `{"requestId":"reset"}`, "https://demo.example", view.Generation, cookie)
	if reset.Code != 200 {
		t.Fatal(reset.Body.String())
	}
	stale := call("POST", "/api/v1/reports/query", `{}`, "https://demo.example", view.Generation, cookie)
	if stale.Code != 409 {
		t.Fatalf("stale generation accepted: %d", stale.Code)
	}
	for path, want := range map[string]int{"/healthz": 200, "/analysis": 200, "/navigation": 200, "/scenes/O08/objects/APP-001": 200, "/assets/missing.js": 404, "/api/v1/unknown": 404, "/unknown": 404} {
		response := call("GET", path, "", "", "", nil)
		if response.Code != want {
			t.Fatalf("%s: want %d got %d", path, want, response.Code)
		}
	}
}
