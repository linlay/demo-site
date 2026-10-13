package mcpserver

import (
	"context"
	"maps"

	"demo-site/backend/internal/model"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MCP exposes primitives; domain rules remain in the existing Go services.
// A workflow call performs exactly one explicit transition, never a batch.
func arraySchema(item any, min, max int) map[string]any {
	return map[string]any{"type": "array", "items": item, "minItems": min, "maxItems": max}
}
func businessBase() map[string]any {
	return map[string]any{"expectedGeneration": textSchema(128), "actorId": textSchema(32)}
}
func mutationBase() map[string]any {
	p := businessBase()
	p["expectedVersion"] = integer(0, 1000000000)
	p["idempotencyKey"] = map[string]any{"type": "string", "pattern": "^[A-Za-z0-9_.:-]{1,128}$"}
	return p
}
func recordsSchema() any {
	p := businessBase()
	p["kind"] = enum("approval", "travel", "expense")
	p["id"] = textSchema(64)
	p["query"] = textSchema(120)
	p["status"] = enum("", "draft", "submitted", "approved", "returned", "withdrawn")
	p["page"] = integer(1, 100000)
	p["pageSize"] = integer(1, 100)
	schema := object(p, "expectedGeneration", "actorId", "kind")
	// A detail lookup cannot silently ignore list filters/pagination.
	schema["oneOf"] = []any{
		map[string]any{"not": map[string]any{"required": []string{"id"}}},
		map[string]any{"required": []string{"id"}, "properties": map[string]any{"id": map[string]any{"minLength": 1}}, "not": map[string]any{"anyOf": []any{map[string]any{"required": []string{"query"}}, map[string]any{"required": []string{"status"}}, map[string]any{"required": []string{"page"}}, map[string]any{"required": []string{"pageSize"}}}}},
	}
	return schema
}
func transitionSchema() any {
	p := mutationBase()
	p["id"] = textSchema(64)
	p["kind"] = enum("approval", "travel", "expense")
	p["action"] = enum("approve", "return", "withdraw", "submit", "resubmit")
	p["opinion"] = textSchema(200)
	schema := object(p, "expectedGeneration", "actorId", "expectedVersion", "idempotencyKey", "id", "kind", "action")
	schema["oneOf"] = []any{
		map[string]any{"properties": map[string]any{"kind": enum("approval"), "action": enum("approve", "return", "withdraw")}},
		map[string]any{"properties": map[string]any{"kind": enum("travel"), "action": enum("approve", "return", "resubmit")}},
		map[string]any{"properties": map[string]any{"kind": enum("expense"), "action": enum("approve", "return", "submit")}},
	}
	schema["if"] = map[string]any{"properties": map[string]any{"action": enum("approve", "return", "withdraw")}}
	schema["then"] = map[string]any{"required": []string{"opinion"}, "properties": map[string]any{"opinion": map[string]any{"minLength": 1}}}
	return schema
}
func (h *Handler) addBusinessTools(s *mcp.Server, v verified) {
	a := model.Access{Principal: &v.Principal}
	p := businessBase()
	maps.Copy(p, map[string]any{"status": enum("open", "done"), "kind": enum("", "approval", "travel", "expense"), "from": textSchema(10), "to": textSchema(10), "query": textSchema(120), "page": integer(1, 100000), "pageSize": integer(1, 100)})
	add(h, s, v, "tasks_query", "查询待办或已办", "status=open（默认）查待办，done查已办；可按来源kind、关键词、北京时间日期和分页筛选。日期筛选待办截止日或已办完成日。total为筛选后的总数；汇总可由多次查询和分页明细计算。来源sourceType/sourceId/sourceVersion可用于单步workflow_transition。", object(p, "expectedGeneration", "actorId"), true, func(ctx context.Context, in model.TaskQuery) (model.BusinessPage[model.BusinessTask], error) {
		return h.Sessions.QueryTasks(ctx, a, in)
	})
	add(h, s, v, "records_query", "查询业务单据", "kind选择approval、travel或expense。省略id查分页列表；指定id查单据详情、任务和历史，不可同时传列表筛选。审批结果附可选materials，差旅详情附assets供票据核验或草稿关联。只读查询不会自动办理。", recordsSchema(), true, func(ctx context.Context, in model.RecordQuery) (model.RecordsPage, error) {
		return h.Sessions.Records(ctx, a, in)
	})
	p = mutationBase()
	maps.Copy(p, map[string]any{"requestId": map[string]any{"type": []string{"string", "null"}, "maxLength": 64}, "title": textSchema(120), "description": textSchema(2000), "materialIds": arraySchema(textSchema(32), 1, 10)})
	add(h, s, v, "approval_submit", "提交审批申请", "提交一步申请，不自动审批。新申请requestId=null、expectedVersion=0；退回或撤回申请传原ID和当前版本。materials从records_query(kind=approval)获取。成功创建主管待办，稳定幂等键用于重试。", object(p, "expectedGeneration", "actorId", "expectedVersion", "idempotencyKey", "requestId", "title", "description", "materialIds"), false, func(ctx context.Context, in model.ApprovalSubmit) (model.BusinessResult, error) {
		return h.Sessions.ApprovalSubmit(ctx, a, in)
	})
	p = mutationBase()
	maps.Copy(p, map[string]any{"departmentId": textSchema(32), "travelerIds": arraySchema(textSchema(32), 1, 10), "origin": textSchema(80), "destination": textSchema(80), "startAt": textSchema(40), "endAt": textSchema(40), "estimatedAmountCents": map[string]any{"type": "integer", "minimum": 1, "maximum": 9007199254740991}})
	add(h, s, v, "travel_submit", "提交差旅申请", "提交未来行程，同行人员同部门且包含申请人；金额以分计，新申请expectedVersion=0。只提交申请，不自动审批或生成报销。", object(p, "expectedGeneration", "actorId", "expectedVersion", "idempotencyKey", "departmentId", "travelerIds", "origin", "destination", "startAt", "endAt", "estimatedAmountCents"), false, func(ctx context.Context, in model.TravelSubmit) (model.BusinessResult, error) {
		return h.Sessions.TravelSubmit(ctx, a, in)
	})
	p = mutationBase()
	maps.Copy(p, map[string]any{"formId": textSchema(64), "applicantId": textSchema(32), "departmentId": textSchema(32), "amountCents": map[string]any{"type": "integer", "minimum": 0, "maximum": 9007199254740991}, "assetIds": arraySchema(textSchema(64), 0, 100)})
	add(h, s, v, "travel_draft_save", "保存差旅草稿", "仅保存当前草稿字段与附件关联。原申请人操作；申请人与部门须匹配；可用assets取自records_query(kind=travel,id=草稿ID)。", object(p, "expectedGeneration", "actorId", "expectedVersion", "idempotencyKey", "formId", "applicantId", "departmentId", "amountCents", "assetIds"), false, func(ctx context.Context, in model.TravelDraft) (model.BusinessResult, error) {
		return h.Sessions.TravelDraftSave(ctx, a, in)
	})
	p = mutationBase()
	p["travelFormId"] = textSchema(64)
	p["filename"] = textSchema(120)
	add(h, s, v, "receipt_register", "登记虚构票据附件", "为本人差旅登记一份虚构票据元数据，返回asset ID供后续expense_prepare核验。只登记元数据，不上传真实文件；expectedVersion为差旅版本。", object(p, "expectedGeneration", "actorId", "expectedVersion", "idempotencyKey", "travelFormId", "filename"), false, func(ctx context.Context, in model.AssetRegister) (model.BusinessResult, error) {
		return h.Sessions.TravelAssetRegister(ctx, a, in)
	})
	money := map[string]any{"type": "integer", "minimum": 1, "maximum": 9007199254740991}
	p = mutationBase()
	maps.Copy(p, map[string]any{"expenseFormId": textSchema(64), "travelFormId": textSchema(64), "receipts": arraySchema(object(map[string]any{"invoiceNo": textSchema(64), "assetId": textSchema(64), "amountCents": money}, "invoiceNo", "assetId", "amountCents"), 1, 20), "lineItems": arraySchema(object(map[string]any{"category": enum("transport", "hotel", "meal", "other"), "invoiceNo": textSchema(64), "amountCents": money}, "category", "invoiceNo", "amountCents"), 1, 40), "declaredTotalCents": money})
	schema := object(p, "expectedGeneration", "actorId", "expectedVersion", "idempotencyKey", "travelFormId", "receipts", "lineItems", "declaredTotalCents")
	schema["oneOf"] = []any{map[string]any{"not": map[string]any{"required": []string{"expenseFormId"}}, "properties": map[string]any{"expectedVersion": map[string]any{"const": 0}}}, map[string]any{"required": []string{"expenseFormId"}, "properties": map[string]any{"expenseFormId": map[string]any{"minLength": 1}, "expectedVersion": map[string]any{"minimum": 1}}}}
	add(h, s, v, "expense_prepare", "核验并保存费用", "核验票据归属、重复报销和各项金额，只保存核验后的费用单。省略expenseFormId且版本0创建草稿；指定原费用ID和版本补正退回单，关联差旅不可改。正式提交与审批分别调用workflow_transition，不自动串联。", schema, false, func(ctx context.Context, in model.ExpenseCheck) (model.BusinessResult, error) {
		return h.Sessions.ExpenseCheck(ctx, a, in, in.ExpenseFormID != "")
	})
	add(h, s, v, "workflow_transition", "执行一步业务状态流转", "每次仅执行一步。approval支持approve/return/withdraw；travel支持approve/return/resubmit；expense支持submit/approve/return。审批限指定主管，撤回/提交/重提限申请人。审批意见或撤回原因必填，使用当前业务版本和稳定幂等键。复杂流程由查询和多次单步流转组成；不会自动核验、补正或审批下一步。", transitionSchema(), false, func(ctx context.Context, in model.WorkflowTransition) (model.BusinessResult, error) {
		return h.Sessions.Transition(ctx, a, in)
	})
}
