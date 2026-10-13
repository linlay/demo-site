package handler_test

import (
	"context"
	"demo-site/backend/internal/config"
	"demo-site/backend/internal/handler"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"demo-site/backend/internal/service"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestHTTPBusinessNullContractValidationAndGenerationFence(t *testing.T) {
	store, err := repository.Open(context.Background(), filepath.Join(t.TempDir(), "business.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	s := &service.Sessions{Store: store, Profile: "acceptance"}
	h := handler.New(s, config.Config{Origins: []string{"https://demo.example"}}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	bootstrap := httptest.NewRecorder()
	h.ServeHTTP(bootstrap, httptest.NewRequest("GET", "https://demo.example/api/v1/session", nil))
	if bootstrap.Code != 200 {
		t.Fatal(bootstrap.Body.String())
	}
	cookie := bootstrap.Result().Cookies()[0]
	var view model.Session
	if err = json.Unmarshal(bootstrap.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	call := func(path, body, generation string, c *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "https://demo.example/api/v1/business/"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://demo.example")
		req.Header.Set("X-Demo-Generation", generation)
		if c != nil {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	input := `{"actorId":"EMP-001","expectedVersion":0,"idempotencyKey":"http-submit","requestId":null,"title":"HTTP申请","description":"虚构说明","materialIds":["APMAT-001"]}`
	valid := call("approval_submit/validate", input, view.Generation, cookie)
	if valid.Code != 200 {
		t.Fatal("null contract validation", valid.Body.String())
	}
	var events int
	if err = store.DB.QueryRow(`SELECT count(*) FROM workspace_events`).Scan(&events); err != nil || events != 0 {
		t.Fatal("validation published event", err)
	}
	submitted := call("approval_submit", input, view.Generation, cookie)
	if submitted.Code != 200 {
		t.Fatal(submitted.Body.String())
	}
	var result model.BusinessResult
	if err = json.Unmarshal(submitted.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	replay := call("approval_submit", input, view.Generation, cookie)
	if replay.Code != 200 || replay.Body.String() != submitted.Body.String() {
		t.Fatal("HTTP retry changed receipt")
	}
	mismatch := call("approvals_query", `{"actorId":"EMP-001","expectedGeneration":"other"}`, view.Generation, cookie)
	if mismatch.Code != 409 {
		t.Fatal("generation override accepted")
	}
	unauthenticated := call("approvals_query", `{"actorId":"EMP-001"}`, view.Generation, nil)
	if unauthenticated.Code != 401 {
		t.Fatal("anonymous business access")
	}
	invalid := call("approval_submit", strings.Replace(input, `"title":"HTTP申请"`, `"title":null`, 1), view.Generation, cookie)
	if invalid.Code != 400 {
		t.Fatal("unexpected null field accepted")
	}
}
