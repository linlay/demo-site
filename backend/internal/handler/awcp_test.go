package handler_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"demo-site/backend/internal/config"
	"demo-site/backend/internal/handler"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"demo-site/backend/internal/service"
)

func TestAWCPSettingsPersistAcrossVisitorsResetAndRestart(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "awcp.sqlite")
	store, err := repository.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	sessions := &service.Sessions{Store: store, Profile: "acceptance"}
	server := handler.New(sessions, config.Config{Origins: []string{"https://demo.example"}}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	call := func(method, body, origin, generation string, cookie *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/v1/settings/awcp", strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if generation != "" {
			req.Header.Set("X-Demo-Generation", generation)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		server.ServeHTTP(rec, req)
		return rec
	}
	setting := func(rec *httptest.ResponseRecorder, enabled bool, version int64) {
		t.Helper()
		var value model.AWCPSettings
		if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &value) != nil || value.ActiveEnabled != enabled || value.Version != version {
			t.Fatalf("unexpected settings: %d %s", rec.Code, rec.Body.String())
		}
	}
	setting(call("GET", "", "", "", nil), false, 1)
	alice, secret, err := sessions.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: "awcp_demo", Value: secret}
	body := `{"activeEnabled":true,"expectedVersion":1}`
	for _, origin := range []string{"", "https://other.example"} {
		if rec := call("POST", body, origin, alice.Generation, cookie); rec.Code != 403 {
			t.Fatal("origin accepted", rec.Code)
		}
	}
	if rec := call("POST", body, "https://demo.example", alice.Generation, nil); rec.Code != 401 {
		t.Fatal("anonymous write accepted", rec.Code)
	}
	if rec := call("POST", body, "https://demo.example", "wrong", cookie); rec.Code != 409 {
		t.Fatal("stale generation accepted", rec.Code)
	}
	for _, invalid := range []string{`{}`, `{"activeEnabled":null,"expectedVersion":1}`, `{"activeEnabled":"true","expectedVersion":1}`, `{"activeEnabled":true,"expectedVersion":0}`, `{"activeEnabled":true,"expectedVersion":1,"extra":1}`} {
		if rec := call("POST", invalid, "https://demo.example", alice.Generation, cookie); rec.Code != 400 {
			t.Fatal("invalid setting accepted", invalid, rec.Code)
		}
	}
	setting(call("POST", body, "https://demo.example", alice.Generation, cookie), true, 2)
	bob, otherSecret, err := sessions.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	otherCookie := &http.Cookie{Name: "awcp_demo", Value: otherSecret}
	setting(call("GET", "", "", "", otherCookie), true, 2)
	if rec := call("POST", `{"activeEnabled":false,"expectedVersion":1}`, "https://demo.example", bob.Generation, otherCookie); rec.Code != 409 {
		t.Fatal("stale setting overwrote the site", rec.Code)
	}
	setting(call("POST", `{"activeEnabled":true,"expectedVersion":2}`, "https://demo.example", alice.Generation, cookie), true, 2)
	setting(call("POST", `{"activeEnabled":false,"expectedVersion":2}`, "https://demo.example", bob.Generation, otherCookie), false, 3)
	setting(call("POST", `{"activeEnabled":true,"expectedVersion":3}`, "https://demo.example", alice.Generation, cookie), true, 4)
	if _, err = sessions.Reset(ctx, secret, alice.Generation, "keep-awcp-settings"); err != nil {
		t.Fatal(err)
	}
	setting(call("GET", "", "", "", nil), true, 4)
	if err = store.DB.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := repository.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	value, err := reopened.AWCPSettings(ctx)
	if err != nil || !value.ActiveEnabled || value.Version != 4 {
		t.Fatal("setting was lost on restart", value, err)
	}
}
