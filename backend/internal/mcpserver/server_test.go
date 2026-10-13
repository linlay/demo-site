package mcpserver_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"demo-site/backend/internal/authn"
	"demo-site/backend/internal/config"
	"demo-site/backend/internal/mcpserver"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"demo-site/backend/internal/service"
)

func setup(t *testing.T) (*mcpserver.Handler, *service.Sessions, model.Session) {
	t.Helper()
	store, err := repository.Open(context.Background(), filepath.Join(t.TempDir(), "mcp.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.DB.Close() })
	s := &service.Sessions{Store: store, Profile: "acceptance"}
	view, cookie, err := s.Bootstrap(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	issuer := "https://auth.example/realms/awcp"
	p := model.Principal{Issuer: issuer, Subject: "user-a", ClientID: "client", Scopes: []string{"context:read", "directory:read", "reports:read", "demo:reset"}}
	if _, _, err = s.ConnectMCP(context.Background(), cookie, p); err != nil {
		t.Fatal(err)
	}
	h := mcpserver.New(config.MCP{Enabled: true, PublicURL: "https://app.example/mcp", Issuer: issuer, Username: "user-a", Password: "test-password", EnableReset: true}, []string{"https://app.example"}, s, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, label := range []string{"full", "read-context", "other-user"} {
		scope := "context:read directory:read reports:read demo:reset"
		subject := "user-a"
		if label == "read-context" {
			scope = "context:read"
		}
		if label == "other-user" {
			subject = "user-b"
		}
		token, _, err := h.Auth.Issue(context.Background(), "client", scope)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.Store.DB.Exec(`UPDATE demo_oauth_tokens SET hash=?,subject=? WHERE hash=?`, authn.Hash(authn.Hash(label)), subject, authn.Hash(token)); err != nil {
			t.Fatal(err)
		}
	}
	return h, s, view
}

func call(t *testing.T, h http.Handler, version, token, method, name string, args any) *httptest.ResponseRecorder {
	t.Helper()
	params := map[string]any{}
	if version == "2026-07-28" {
		params["_meta"] = map[string]any{"io.modelcontextprotocol/protocolVersion": version, "io.modelcontextprotocol/clientInfo": map[string]string{"name": "integration-test", "version": "1.0.0"}, "io.modelcontextprotocol/clientCapabilities": map[string]any{}}
	}
	if name != "" {
		params["name"] = name
		params["arguments"] = args
	}
	if method == "initialize" {
		params = map[string]any{"protocolVersion": version, "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "test", "version": "1"}}
	}
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "https://app.example/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", version)
	req.Header.Set("MCP-Method", method)
	if name != "" {
		req.Header.Set("MCP-Name", name)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+authn.Hash(token))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}
func result(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if rec.Code != 200 {
		t.Fatalf("HTTP %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if err, ok := body["error"]; ok {
		t.Fatalf("RPC error: %+v", err)
	}
	value, ok := body["result"].(map[string]any)
	if !ok {
		t.Fatalf("missing result: %s", rec.Body.String())
	}
	return value
}

func TestMetadataAuthenticationOriginAndScopeChallenges(t *testing.T) {
	h, _, _ := setup(t)
	metadata := httptest.NewRecorder()
	h.Metadata(metadata, httptest.NewRequest("GET", "https://app.example/.well-known/oauth-protected-resource/mcp", nil))
	if metadata.Code != 200 || !strings.Contains(metadata.Body.String(), `"resource":"https://app.example/mcp"`) {
		t.Fatal(metadata.Body.String())
	}
	for _, token := range []string{"", "invalid"} {
		rec := call(t, h, "2026-07-28", token, "tools/list", "", nil)
		if rec.Code != 401 || !strings.Contains(rec.Header().Get("WWW-Authenticate"), "resource_metadata=") {
			t.Fatalf("missing discovery challenge: %d", rec.Code)
		}
	}
	denied := call(t, h, "2026-07-28", "read-context", "tools/call", "demo_analysis_query", map[string]any{})
	if denied.Code != 403 || !strings.Contains(denied.Header().Get("WWW-Authenticate"), `scope="reports:read"`) {
		t.Fatal("missing scope challenge")
	}
	for _, origin := range []string{"https://evil.example", "null"} {
		req := httptest.NewRequest("POST", "https://app.example/mcp", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 403 {
			t.Fatalf("origin %s accepted", origin)
		}
	}
	req := httptest.NewRequest("POST", "https://evil.example/mcp", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatal("untrusted Host accepted")
	}
}

func TestToolDiscoveryAndCallsAcrossNewAndLegacyProtocol(t *testing.T) {
	h, _, view := setup(t)
	for _, version := range []string{"2026-07-28", "2025-11-25"} {
		t.Run(version, func(t *testing.T) {
			if version == "2025-11-25" {
				result(t, call(t, h, version, "full", "initialize", "", nil))
			}
			listed := result(t, call(t, h, version, "full", "tools/list", "", nil))
			tools := listed["tools"].([]any)
			if len(tools) != 6 {
				t.Fatalf("got %d tools", len(tools))
			}
			for _, raw := range tools {
				tool := raw.(map[string]any)
				if tool["inputSchema"] == nil || tool["outputSchema"] == nil {
					t.Fatal("missing schemas")
				}
			}
			contextResult := result(t, call(t, h, version, "full", "tools/call", "demo_context_get", map[string]any{}))
			content := contextResult["structuredContent"].(map[string]any)
			if content["workspaceId"] != view.ID {
				t.Fatalf("wrong workspace: %+v", content)
			}
			report := result(t, call(t, h, version, "full", "tools/call", "demo_analysis_query", map[string]any{"expectedGeneration": view.Generation, "filter": map[string]any{"pageSize": 5}}))
			data := report["structuredContent"].(map[string]any)
			if data["dataSource"] != "historical-fixtures" {
				t.Fatal("missing fixture label")
			}
			items := data["report"].(map[string]any)["items"].([]any)
			if len(items) != 5 {
				t.Fatalf("got %d entries", len(items))
			}
		})
	}
	limited := result(t, call(t, h, "2026-07-28", "read-context", "tools/list", "", nil))
	if len(limited["tools"].([]any)) != 2 {
		t.Fatal("scope-filtered registry leaked tools")
	}
	other := result(t, call(t, h, "2026-07-28", "other-user", "tools/call", "demo_context_get", map[string]any{}))
	if other["isError"] != true {
		t.Fatal("another user read workspace")
	}
	stale := result(t, call(t, h, "2026-07-28", "full", "tools/call", "demo_analysis_query", map[string]any{"expectedGeneration": "stale", "filter": map[string]any{}}))
	if stale["isError"] != true {
		t.Fatal("stale generation accepted")
	}
}

func TestToolSchemaRejectsExtraFieldsAndInvalidPagination(t *testing.T) {
	h, _, _ := setup(t)
	for _, args := range []map[string]any{{"sessionId": "victim"}, {"pageSize": 101}, {"pageSize": nil}} {
		rec := call(t, h, "2026-07-28", "full", "tools/call", "demo_directory_query", args)
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["error"] == nil {
			r, _ := body["result"].(map[string]any)
			if r["isError"] != true {
				t.Fatalf("invalid input accepted: %s", rec.Body.String())
			}
		}
	}
}
