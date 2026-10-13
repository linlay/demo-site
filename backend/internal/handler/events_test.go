package handler_test

import (
	"bufio"
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
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSSEReplayIsolationAndDisconnect(t *testing.T) {
	ctx := context.Background()
	store, err := repository.Open(ctx, filepath.Join(t.TempDir(), "events.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	sessions := &service.Sessions{Store: store, Profile: "acceptance"}
	h := handler.New(sessions, config.Config{Origins: []string{"https://demo.example"}}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(h)
	defer server.Close()
	a, cookie, err := sessions.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/events", "/api/v1/events?after=other:20"} {
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 401 {
			t.Fatal("unauthenticated stream accepted")
		}
	}
	next, err := sessions.Reset(ctx, cookie, a.Generation, "first")
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest("GET", server.URL+"/api/v1/events?after="+url.QueryEscape(a.EventCursor), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(&http.Cookie{Name: "awcp_demo", Value: cookie})
	bounded, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	request = request.WithContext(bounded)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || !strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") || response.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("SSE headers: %+v", response.Header)
	}
	reader := bufio.NewScanner(response.Body)
	found := false
	for reader.Scan() {
		line := reader.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var event model.WorkspaceEvent
		_ = json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event)
		if event.Type != "workspace.reset" {
			continue
		}
		if event.ID != next.EventCursor || event.OperationID != "first" {
			t.Fatalf("bad event %+v", event)
		}
		found = true
		break
	}
	if !found {
		t.Fatalf("no replay: %v", reader.Err())
	}
	response.Body.Close()
	cancel()
	// Last-Event-ID wins over the initial URL cursor on reconnect.
	bounded2, cancel2 := context.WithTimeout(ctx, 4*time.Second)
	defer cancel2()
	request = request.Clone(bounded2)
	request.Header.Set("Last-Event-ID", next.EventCursor)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	final, err := sessions.Reset(ctx, cookie, next.Generation, "second")
	if err != nil {
		t.Fatal(err)
	}
	reader = bufio.NewScanner(response.Body)
	found = false
	for reader.Scan() {
		line := reader.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var event model.WorkspaceEvent
		_ = json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event)
		if event.Type != "workspace.reset" {
			continue
		}
		if event.ID != final.EventCursor {
			t.Fatal("replayed acknowledged event")
		}
		found = true
		break
	}
	if !found {
		t.Fatalf("no live event: %v", reader.Err())
	}
}
