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
	"demo_context_get": "context:read", "demo_scenarios_list": "context:read",
	"demo_directory_query": "directory:read", "demo_analysis_query": "reports:read",
	"demo_reset_preview": "demo:reset", "demo_reset_execute": "demo:reset",
}

type Empty struct{}
type ContextOutput struct {
	Principal      model.Principal `json:"principal"`
	WorkspaceID    string          `json:"workspaceId"`
	Generation     string          `json:"generation"`
	DatasetVersion string          `json:"datasetVersion"`
	ExpiresAt      string          `json:"expiresAt"`
	RecordCount    int             `json:"recordCount"`
	DataSource     string          `json:"dataSource"`
	ConnectURL     string          `json:"connectUrl"`
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
	closed, destructive := false, name == "demo_reset_execute"
	mcp.AddTool(s, &mcp.Tool{Name: name, Title: title, Description: description, InputSchema: schema, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: readOnly, DestructiveHint: &destructive, OpenWorldHint: &closed, IdempotentHint: name == "demo_reset_execute"}}, func(ctx context.Context, req *mcp.CallToolRequest, in In) (*mcp.CallToolResult, Out, error) {
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
	add(h, s, v, "demo_context_get", "读取演示上下文", "读取已授权空间及当前数据版本；历史样本不代表实时业务。未关联时按错误中的 connectUrl 登录。", object(nil), true, func(ctx context.Context, _ Empty) (ContextOutput, error) {
		view, err := h.Sessions.MCPContext(ctx, p)
		return ContextOutput{Principal: p, WorkspaceID: view.ID, Generation: view.Generation, DatasetVersion: view.DatasetVersion, ExpiresAt: view.ExpiresAt, RecordCount: view.RecordCount, DataSource: "historical-fixtures", ConnectURL: h.Config.ConnectURL()}, err
	})
	add(h, s, v, "demo_scenarios_list", "查询场景支持状态", "列出既有场景及后端迁移状态；browser-only 场景当前不能通过 MCP 办理。", object(nil), true, func(_ context.Context, _ Empty) (CatalogOutput, error) {
		return CatalogOutput{Scenarios: scenarioCatalog}, nil
	})
	add(h, s, v, "demo_directory_query", "查询演示组织人员", "分页查询当前授权空间的虚构人员；列表不代表已授予这些人员的业务操作权。", object(map[string]any{"departmentId": textSchema(32), "query": textSchema(120), "page": integer(1, 100000), "pageSize": integer(1, 100)}), true, func(ctx context.Context, in service.DirectoryFilter) (service.DirectoryResult, error) {
		return h.Sessions.MCPDirectory(ctx, p, in)
	})
	filter := object(map[string]any{"from": textSchema(10), "to": textSchema(10), "departmentId": textSchema(32), "scenarioId": enum("", "O08", "O09", "O11", "O12", "O15"), "status": enum("", "pending", "approved", "returned", "withdrawn"), "groupBy": enum("month", "department", "scenario", "status"), "page": integer(1, 100000), "pageSize": integer(1, 100)})
	add(h, s, v, "demo_analysis_query", "查询历史分析", "查询 SQLite 固定历史样本。先取得 expectedGeneration；支持日期、部门、场景、状态筛选及最多 100 条分页。", object(map[string]any{"expectedGeneration": textSchema(128), "filter": filter}, "expectedGeneration", "filter"), true, func(ctx context.Context, in AnalysisInput) (AnalysisOutput, error) {
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
		return AnalysisOutput{DataSource: "historical-fixtures", Report: report}, err
	})
	if h.Config.EnableReset {
		add(h, s, v, "demo_reset_preview", "预览重置", "生成绑定当前身份、客户端和数据版本的五分钟重置凭据。请向用户说明重置影响；不会修改业务数据。", object(map[string]any{"expectedGeneration": textSchema(128)}, "expectedGeneration"), false, func(ctx context.Context, in GenerationInput) (service.ResetPreview, error) {
			return h.Sessions.MCPResetPreview(ctx, p, in.ExpectedGeneration)
		})
		add(h, s, v, "demo_reset_execute", "重置演示空间", "用户确认后，凭预览令牌恢复当前空间。取消不能回滚已提交重置；响应丢失必须使用原幂等键和原凭据重试。", object(map[string]any{"expectedGeneration": textSchema(128), "idempotencyKey": map[string]any{"type": "string", "pattern": "^[A-Za-z0-9_.:-]{1,128}$"}, "confirmationToken": textSchema(128)}, "expectedGeneration", "idempotencyKey", "confirmationToken"), false, func(ctx context.Context, in ResetInput) (ResetOutput, error) {
			view, err := h.Sessions.MCPReset(ctx, p, in.ExpectedGeneration, in.IdempotencyKey, in.ConfirmationToken)
			return ResetOutput{WorkspaceID: view.ID, Generation: view.Generation, RecordCount: view.RecordCount}, err
		})
	}
	return s
}
