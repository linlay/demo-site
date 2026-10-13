package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"demo-site/backend/internal/model"
	"demo-site/backend/internal/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var toolScopes = map[string]string{
	"context_get": "context:read", "directory_query": "directory:read", "analysis_query": "reports:read",
	"tasks_query": "business:read", "records_query": "business:read",
	"approval_submit": "business:write", "travel_submit": "business:write", "travel_draft_save": "business:write",
	"receipt_register": "business:write", "expense_prepare": "business:write", "workflow_transition": "business:write",
	"workspace_reset_preview": "demo:reset", "workspace_reset_execute": "demo:reset",
}

type Empty struct{}
type WorkflowCapability struct {
	Kind    string   `json:"kind"`
	Actions []string `json:"actions"`
}
type ContextOutput struct {
	Scenarios      []Scenario           `json:"scenarios"`
	Workflow       []WorkflowCapability `json:"workflow"`
	DataSources    []string             `json:"dataSources"`
	CurrentTime    string               `json:"currentTime"`
	DefaultActorID string               `json:"defaultActorId"`
	ActorSelection string               `json:"actorSelection"`
	Principal      model.Principal      `json:"principal"`
	WorkspaceID    string               `json:"workspaceId"`
	Generation     string               `json:"generation"`
	DatasetVersion string               `json:"datasetVersion"`
	ExpiresAt      string               `json:"expiresAt"`
	RecordCount    int                  `json:"recordCount"`
	DataSource     string               `json:"dataSource"`
	ConnectURL     string               `json:"connectUrl"`
}
type AnalysisInput struct {
	ExpectedGeneration string             `json:"expectedGeneration"`
	Filter             model.ReportFilter `json:"filter"`
}
type AnalysisOutput struct {
	DataSource string       `json:"dataSource"`
	Report     model.Report `json:"report"`
}
type GenerationInput struct {
	ExpectedGeneration string `json:"expectedGeneration"`
}
type ResetInput struct {
	ExpectedGeneration string `json:"expectedGeneration"`
	IdempotencyKey     string `json:"idempotencyKey"`
	ConfirmationToken  string `json:"confirmationToken"`
}
type ResetOutput struct {
	WorkspaceID string `json:"workspaceId"`
	Generation  string `json:"generation"`
	RecordCount int    `json:"recordCount"`
}

func object(properties map[string]any, required ...string) map[string]any {
	if properties == nil {
		properties = map[string]any{}
	}
	result := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		result["required"] = required
	}
	return result
}
func textSchema(max int) map[string]any    { return map[string]any{"type": "string", "maxLength": max} }
func enum(values ...string) map[string]any { return map[string]any{"type": "string", "enum": values} }
func integer(min, max int) map[string]any {
	return map[string]any{"type": "integer", "minimum": min, "maximum": max}
}

func add[In, Out any](h *Handler, s *mcp.Server, v verified, name, title, description string, schema any, readOnly bool, fn func(context.Context, In) (Out, error)) {
	scope := toolScopes[name]
	if !v.Principal.HasScope(scope) {
		return
	}
	closed, destructive := false, name == "workspace_reset_execute"
	mcp.AddTool(s, &mcp.Tool{Name: name, Title: title, Description: description, InputSchema: schema, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: readOnly, DestructiveHint: &destructive, OpenWorldHint: &closed, IdempotentHint: readOnly || name != "workspace_reset_preview"}}, func(ctx context.Context, req *mcp.CallToolRequest, in In) (*mcp.CallToolResult, Out, error) {
		started := time.Now()
		var zero Out
		ctx, cancel := context.WithDeadline(ctx, minTime(v.Expiry, started.Add(25*time.Second)))
		defer cancel()
		out, err := fn(ctx, in)
		if err != nil {
			var controlled *model.Error
			if !errors.As(err, &controlled) {
				controlled = model.Failure(500, "server.internal", "服务暂时无法完成请求，请重试。")
				h.Logger.Error("mcp tool failed", "tool", name, "error", err)
			}
			h.Logger.Info("mcp call", "tool", name, "subject", v.Principal.Subject, "client", v.Principal.ClientID, "outcome", controlled.Code, "duration_ms", time.Since(started).Milliseconds())
			payload, _ := json.Marshal(map[string]any{"code": controlled.Code, "message": controlled.Message, "fieldErrors": controlled.FieldErrors, "connectUrl": h.Config.ConnectURL()})
			return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: string(payload)}}}, zero, nil
		}
		h.Logger.Info("mcp call", "tool", name, "subject", v.Principal.Subject, "client", v.Principal.ClientID, "outcome", "completed", "duration_ms", time.Since(started).Milliseconds())
		return nil, out, nil
	})
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func (h *Handler) server(v verified) *mcp.Server {
	s := mcp.NewServer(protocolImplementation, &mcp.ServerOptions{Logger: h.Logger, Capabilities: &mcp.ServerCapabilities{Tools: &mcp.ToolCapabilities{}}})
	p := v.Principal
	add(h, s, v, "context_get", "读取演示上下文", "读取已授权空间、场景支持、单步流转动作及当前数据版本；包含业务数据与历史样本，actorId仅用于虚构人员角色模拟。未关联时按错误中的 connectUrl 登录。", object(nil), true, func(ctx context.Context, _ Empty) (ContextOutput, error) {
		view, err := h.Sessions.MCPContext(ctx, p)
		return ContextOutput{Scenarios: scenarioCatalog, Workflow: []WorkflowCapability{{Kind: "approval", Actions: []string{"approve", "return", "withdraw"}}, {Kind: "travel", Actions: []string{"approve", "return", "resubmit"}}, {Kind: "expense", Actions: []string{"submit", "approve", "return"}}}, Principal: p, WorkspaceID: view.ID, Generation: view.Generation, DatasetVersion: view.DatasetVersion, ExpiresAt: view.ExpiresAt, RecordCount: view.RecordCount, DataSource: "workspace", DataSources: []string{"business", "historical-fixtures"}, CurrentTime: time.Now().UTC().Format(time.RFC3339), DefaultActorID: "EMP-002", ActorSelection: "actorId selects a fictional employee role within this authorized workspace; directory_query lists available roles", ConnectURL: h.Config.ConnectURL()}, err
	})
	add(h, s, v, "directory_query", "查询演示组织人员", "分页查询当前授权空间的虚构人员；列表不代表已授予这些人员的业务操作权。", object(map[string]any{"departmentId": textSchema(32), "query": textSchema(120), "page": integer(1, 100000), "pageSize": integer(1, 100)}), true, func(ctx context.Context, in service.DirectoryFilter) (service.DirectoryResult, error) {
		return h.Sessions.MCPDirectory(ctx, p, in)
	})
	filter := object(map[string]any{"dataSource": enum("business", "historical-fixtures"), "kind": enum("", "approval", "travel", "expense"), "from": textSchema(10), "to": textSchema(10), "departmentId": textSchema(32), "scenarioId": enum("", "O08", "O09", "O11", "O12", "O15"), "status": enum("", "pending", "approved", "returned", "withdrawn", "draft"), "groupBy": enum("month", "department", "scenario", "status"), "page": integer(1, 100000), "pageSize": integer(1, 100)})
	add(h, s, v, "analysis_query", "查询数据分析", "默认统计SQLite实时业务表（O08/O09），可显式选择historical-fixtures历史样本。先读context_get取得expectedGeneration，支持筛选、分组和最多100条分页。差旅预算与报销是独立单据，按单据口径统计金额。", object(map[string]any{"expectedGeneration": textSchema(128), "filter": filter}, "expectedGeneration", "filter"), true, func(ctx context.Context, in AnalysisInput) (AnalysisOutput, error) {
		if in.Filter.DataSource == "" {
			in.Filter.DataSource = "business"
		}
		if in.Filter.GroupBy == "" {
			in.Filter.GroupBy = "month"
		}
		if in.Filter.Page == 0 {
			in.Filter.Page = 1
		}
		if in.Filter.PageSize == 0 {
			in.Filter.PageSize = 20
		}
		report, err := h.Sessions.MCPReport(ctx, p, in.ExpectedGeneration, in.Filter)
		return AnalysisOutput{DataSource: in.Filter.DataSource, Report: report}, err
	})
	if h.Config.EnableReset {
		add(h, s, v, "workspace_reset_preview", "预览重置", "生成绑定当前身份、客户端和数据版本的五分钟重置凭据。请向用户说明重置影响；不会修改业务数据。", object(map[string]any{"expectedGeneration": textSchema(128)}, "expectedGeneration"), false, func(ctx context.Context, in GenerationInput) (service.ResetPreview, error) {
			return h.Sessions.MCPResetPreview(ctx, p, in.ExpectedGeneration)
		})
		add(h, s, v, "workspace_reset_execute", "重置演示空间", "用户确认后，凭预览令牌恢复当前空间。取消不能回滚已提交重置；响应丢失必须使用原幂等键和原凭据重试。", object(map[string]any{"expectedGeneration": textSchema(128), "idempotencyKey": map[string]any{"type": "string", "pattern": "^[A-Za-z0-9_.:-]{1,128}$"}, "confirmationToken": textSchema(128)}, "expectedGeneration", "idempotencyKey", "confirmationToken"), false, func(ctx context.Context, in ResetInput) (ResetOutput, error) {
			view, err := h.Sessions.MCPReset(ctx, p, in.ExpectedGeneration, in.IdempotencyKey, in.ConfirmationToken)
			return ResetOutput{WorkspaceID: view.ID, Generation: view.Generation, RecordCount: view.RecordCount}, err
		})
	}
	h.addBusinessTools(s, v)
	return s
}
