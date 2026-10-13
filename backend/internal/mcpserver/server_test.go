package mcpserver_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
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
	p := model.Principal{Issuer: issuer, Subject: "user-a", ClientID: "client", Scopes: []string{"context:read", "directory:read", "reports:read", "business:read", "business:write", "demo:reset"}}
	if _, _, err = s.ConnectMCP(context.Background(), cookie, p); err != nil {
		t.Fatal(err)
	}
	h := mcpserver.New(config.MCP{Enabled: true, PublicURL: "https://app.example/mcp", Issuer: issuer, Username: "user-a", Password: "test-password", EnableReset: true}, []string{"https://app.example"}, s, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, label := range []string{"full", "read-context", "other-user"} {
		scope := "context:read directory:read reports:read business:read business:write demo:reset"
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
	denied := call(t, h, "2026-07-28", "read-context", "tools/call", "analysis_query", map[string]any{})
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
			if len(tools) != 13 {
				t.Fatalf("got %d tools", len(tools))
			}
			for _, raw := range tools {
				tool := raw.(map[string]any)
				if tool["inputSchema"] == nil || tool["outputSchema"] == nil {
					t.Fatal("missing schemas")
				}
			}
			contextResult := result(t, call(t, h, version, "full", "tools/call", "context_get", map[string]any{}))
			content := contextResult["structuredContent"].(map[string]any)
			if content["workspaceId"] != view.ID {
				t.Fatalf("wrong workspace: %+v", content)
			}
			report := result(t, call(t, h, version, "full", "tools/call", "analysis_query", map[string]any{"expectedGeneration": view.Generation, "filter": map[string]any{"pageSize": 5, "dataSource": "historical-fixtures"}}))
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
	if len(limited["tools"].([]any)) != 1 {
		t.Fatal("scope-filtered registry leaked tools")
	}
	other := result(t, call(t, h, "2026-07-28", "other-user", "tools/call", "context_get", map[string]any{}))
	if other["isError"] != true {
		t.Fatal("another user read workspace")
	}
	stale := result(t, call(t, h, "2026-07-28", "full", "tools/call", "analysis_query", map[string]any{"expectedGeneration": "stale", "filter": map[string]any{}}))
	if stale["isError"] != true {
		t.Fatal("stale generation accepted")
	}
}

func TestToolSchemaRejectsExtraFieldsAndInvalidPagination(t *testing.T) {
	h, _, _ := setup(t)
	for _, args := range []map[string]any{{"sessionId": "victim"}, {"pageSize": 101}, {"pageSize": nil}} {
		rec := call(t, h, "2026-07-28", "full", "tools/call", "directory_query", args)
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

func TestBusinessToolsCommitAndScopeFiltering(t *testing.T) {
	h, _, view := setup(t)
	listed := result(t, call(t, h, "2026-07-28", "full", "tools/list", "", nil))
	for _, raw := range listed["tools"].([]any) {
		if strings.HasPrefix(raw.(map[string]any)["name"].(string), "demo_") {
			t.Fatal("legacy tool prefix exposed")
		}
	}
	args := map[string]any{"expectedGeneration": view.Generation, "actorId": "EMP-001", "expectedVersion": 0, "idempotencyKey": "mcp-business-submit", "requestId": nil, "title": "虚构MCP申请", "description": "办理能力验证", "materialIds": []string{"APMAT-001"}}
	submitted := result(t, call(t, h, "2026-07-28", "full", "tools/call", "approval_submit", args))
	if submitted["isError"] == true {
		t.Fatalf("submit: %+v", submitted)
	}
	item := submitted["structuredContent"].(map[string]any)
	denied := call(t, h, "2026-07-28", "read-context", "tools/call", "workflow_transition", map[string]any{})
	if denied.Code != 403 || !strings.Contains(denied.Header().Get("WWW-Authenticate"), "business:write") {
		t.Fatal("write scope bypassed")
	}
	approved := result(t, call(t, h, "2026-07-28", "full", "tools/call", "workflow_transition", map[string]any{"kind": "approval", "action": "approve", "expectedGeneration": view.Generation, "actorId": "EMP-002", "expectedVersion": 1, "idempotencyKey": "mcp-approve", "id": item["id"], "opinion": "同意"}))
	if approved["isError"] == true {
		t.Fatalf("approve: %+v", approved)
	}
	done := result(t, call(t, h, "2026-07-28", "full", "tools/call", "tasks_query", map[string]any{"status": "done", "expectedGeneration": view.Generation, "actorId": "EMP-002"}))
	if done["structuredContent"].(map[string]any)["total"] != float64(3) {
		t.Fatalf("done: %+v", done)
	}
	catalog := result(t, call(t, h, "2026-07-28", "full", "tools/call", "context_get", map[string]any{}))
	if len(catalog["structuredContent"].(map[string]any)["scenarios"].([]any)) != 31 {
		t.Fatal("scenario inventory incomplete")
	}
}

func TestPrimitiveCatalogMatchesDiscoveryAndRemovesCompositeAliases(t *testing.T) {
	h, _, _ := setup(t)
	var catalog struct {
		DefaultToolCount  int `json:"defaultToolCount"`
		OptionalToolCount int `json:"optionalToolCount"`
		Tools             []struct {
			Name, Scope string
			ReadOnly    bool `json:"readOnly"`
		} `json:"tools"`
		OptionalTools []struct {
			Name, Scope string
			ReadOnly    bool `json:"readOnly"`
		} `json:"optionalTools"`
	}
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "mcp", "tools.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &catalog); err != nil {
		t.Fatal(err)
	}
	if catalog.DefaultToolCount != 11 || catalog.OptionalToolCount != 2 || len(catalog.Tools) != 11 || len(catalog.OptionalTools) != 2 {
		t.Fatal("catalog count")
	}
	expected := map[string]bool{}
	for _, entry := range append(catalog.Tools, catalog.OptionalTools...) {
		expected[entry.Name] = entry.ReadOnly
	}
	for _, reset := range []bool{false, true} {
		h.Config.EnableReset = reset
		listed := result(t, call(t, h, "2026-07-28", "full", "tools/list", "", nil))["tools"].([]any)
		count := 11
		if reset {
			count = 13
		}
		if len(listed) != count {
			t.Fatalf("tools %d", len(listed))
		}
		for _, raw := range listed {
			tool := raw.(map[string]any)
			name := tool["name"].(string)
			readOnly, ok := expected[name]
			if !ok {
				t.Fatalf("unexpected tool %s", name)
			}
			annotations := tool["annotations"].(map[string]any)
			if (annotations["readOnlyHint"] == true) != readOnly {
				t.Fatalf("wrong readonly scope %s", name)
			}
		}
	}
	// Every documented scope must expose exactly its tools; merging entry
	// points must not accidentally expose writes to a business-read token.
	entries := append(catalog.Tools, catalog.OptionalTools...)
	checkedScopes := map[string]bool{}
	for _, entry := range entries {
		if checkedScopes[entry.Scope] {
			continue
		}
		checkedScopes[entry.Scope] = true
		scopes := "context:read"
		if entry.Scope != "context:read" {
			scopes += " " + entry.Scope
		}
		token, _, err := h.Auth.Issue(context.Background(), "client", scopes)
		if err != nil {
			t.Fatal(err)
		}
		label := "scope-" + entry.Scope
		if _, err = h.Sessions.Store.DB.Exec(`UPDATE demo_oauth_tokens SET hash=? WHERE hash=?`, authn.Hash(authn.Hash(label)), authn.Hash(token)); err != nil {
			t.Fatal(err)
		}
		wanted := map[string]bool{}
		for _, candidate := range entries {
			if candidate.Scope == entry.Scope || candidate.Scope == "context:read" {
				wanted[candidate.Name] = true
			}
		}
		listed := result(t, call(t, h, "2026-07-28", label, "tools/list", "", nil))["tools"].([]any)
		if len(listed) != len(wanted) {
			t.Fatalf("scope %s: wrong tool count %d", entry.Scope, len(listed))
		}
		for _, raw := range listed {
			name := raw.(map[string]any)["name"].(string)
			if !wanted[name] {
				t.Fatalf("scope %s exposes %s", entry.Scope, name)
			}
		}
	}
	// Removed aliases must not remain callable outside tools/list.
	for _, name := range []string{"scenarios_list", "done_query", "workbench_summary", "todo_summarize", "todo_complete", "approval_approve", "travel_receipts_list", "expense_check"} {
		rec := call(t, h, "2026-07-28", "full", "tools/call", name, map[string]any{})
		var rpc map[string]any
		if err = json.Unmarshal(rec.Body.Bytes(), &rpc); err != nil {
			t.Fatal(err)
		}
		if rpc["error"] == nil {
			r, _ := rpc["result"].(map[string]any)
			if r["isError"] != true {
				t.Fatalf("removed alias callable: %s", name)
			}
		}
	}
}
func TestPrimitiveSchemasRejectInvalidPairsAndCompoundSteps(t *testing.T) {
	h, s, view := setup(t)
	cases := []struct {
		name string
		args map[string]any
	}{
		{"workflow_transition", map[string]any{"kind": "approval", "action": "submit"}},
		{"workflow_transition", map[string]any{"kind": "expense", "action": "withdraw"}},
		{"workflow_transition", map[string]any{"kind": "travel", "action": "submit"}},
		{"workflow_transition", map[string]any{"kind": "approval", "action": []string{"approve", "return"}}},
		{"workflow_transition", map[string]any{"kind": "approval", "action": "approve", "opinion": nil}},
		{"records_query", map[string]any{"kind": "approval", "id": "APPR-001", "page": 1}},
		{"records_query", map[string]any{"kind": "approval", "id": ""}},
		{"tasks_query", map[string]any{"status": "all"}},
		{"tasks_query", map[string]any{"status": "done", "from": "2026-02-30"}},
		{"expense_prepare", map[string]any{"expenseFormId": "", "expectedVersion": 0}},
	}
	for n, test := range cases {
		args := map[string]any{"expectedGeneration": view.Generation, "actorId": "EMP-002", "id": "APPR-001", "expectedVersion": 1, "idempotencyKey": fmt.Sprintf("invalid-%d", n), "opinion": "单步Schema校验"}
		if test.name != "workflow_transition" {
			delete(args, "id")
			delete(args, "expectedVersion")
			delete(args, "idempotencyKey")
			delete(args, "opinion")
		}
		if test.name == "expense_prepare" {
			args["travelFormId"] = "TRAVEL-001"
			args["expectedVersion"] = 0
			args["idempotencyKey"] = fmt.Sprintf("invalid-%d", n)
			args["receipts"] = []map[string]any{{"invoiceNo": "invoice", "assetId": "asset", "amountCents": 100}}
			args["lineItems"] = []map[string]any{{"invoiceNo": "invoice", "category": "transport", "amountCents": 100}}
			args["declaredTotalCents"] = 100
		}
		for k, v := range test.args {
			args[k] = v
		}
		rec := call(t, h, "2026-07-28", "full", "tools/call", test.name, args)
		var rpc map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &rpc); err != nil {
			t.Fatal(err)
		}
		if rpc["error"] == nil {
			r, _ := rpc["result"].(map[string]any)
			if r["isError"] != true {
				t.Fatalf("invalid primitive accepted: %s", rec.Body.String())
			}
		}
	}
	var events int
	if err := s.Store.DB.QueryRow(`SELECT count(*) FROM workspace_events`).Scan(&events); err != nil || events != 0 {
		t.Fatal("invalid primitive changed business", err)
	}
}
