package service

import (
	"context"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"encoding/json"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

func BrowserAccess(token string) model.Access { return model.Access{CookieHash: tokenHash(token)} }
func businessAccess(a model.Access, scope string, generation string) error {
	if a.Principal != nil {
		if err := requireScope(*a.Principal, scope); err != nil {
			return err
		}
	} else if a.CookieHash == "" || a.CookieHash == tokenHash("") {
		return model.Failure(401, "session.expired", "请先建立会话。")
	}
	if generation == "" {
		return model.Invalid("expectedGeneration", "请先读取当前上下文。")
	}
	return nil
}
func queryDefaults(q *model.BusinessQuery) error {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.PageSize == 0 {
		q.PageSize = 20
	}
	if q.Page < 1 || q.Page > 100000 || q.PageSize < 1 || q.PageSize > 100 {
		return model.Invalid("page", "分页超出范围。")
	}
	if q.Status != "" && !slices.Contains([]string{"draft", "submitted", "approved", "returned", "withdrawn"}, q.Status) {
		return model.Invalid("status", "状态无效。")
	}
	if utf8.RuneCountInString(q.Query) > 120 {
		return model.Invalid("query", "关键词最多120字。")
	}
	return nil
}
func validateMutation(m model.BusinessMutation) error {
	if !resetKey.MatchString(m.IdempotencyKey) {
		return model.Invalid("idempotencyKey", "需要1～128位有效业务幂等键。")
	}
	if m.ExpectedVersion < 0 {
		return model.Invalid("expectedVersion", "版本不能为负数。")
	}
	return nil
}
func bounded(field, value string, max int) error {
	if strings.TrimSpace(value) == "" || utf8.RuneCountInString(strings.TrimSpace(value)) > max {
		return model.Invalid(field, "内容不能为空或超出长度限制。")
	}
	return nil
}
func version(actual, expected int) error {
	if actual != expected {
		return model.Failure(409, "action.version-conflict", "业务版本已变化，请刷新后重试。")
	}
	return nil
}
func role(actor model.Employee, name string) bool { return slices.Contains(actor.Roles, name) }
func canRead(actor model.Employee, applicant, reviewer string) error {
	if actor.ID != applicant && actor.ID != reviewer {
		return model.Failure(403, "action.forbidden", "只有申请人或指定审批人可以读取此单据。")
	}
	return nil
}
func fingerprint(in any) string    { raw, _ := json.Marshal(in); return string(raw) }
func pointer(value string) *string { return &value }
func page[T any](items []T, q model.BusinessQuery, b *repository.BusinessTx) model.BusinessPage[T] {
	out := model.BusinessPage[T]{Items: []T{}, Total: len(items), Page: q.Page, PageSize: q.PageSize, Generation: b.Session.Generation, Revision: b.Session.Revision}
	start := (q.Page - 1) * q.PageSize
	if start < len(items) {
		out.Items = items[start:min(start+q.PageSize, len(items))]
	}
	return out
}
func matches(q model.BusinessQuery, status, text string) bool {
	return (q.Status == "" || q.Status == status) && (q.Query == "" || strings.Contains(strings.ToLower(text), strings.ToLower(strings.TrimSpace(q.Query))))
}
func (s *Sessions) Tasks(ctx context.Context, a model.Access, q model.BusinessQuery, done bool) (model.BusinessPage[model.BusinessTask], error) {
	status := "open"
	if done {
		status = "done"
	}
	return s.queryTasks(ctx, a, q, status, "", "", "")
}
func (s *Sessions) QueryTasks(ctx context.Context, a model.Access, in model.TaskQuery) (model.BusinessPage[model.BusinessTask], error) {
	var out model.BusinessPage[model.BusinessTask]
	if in.Status == "" {
		in.Status = "open"
	}
	if !slices.Contains([]string{"open", "done"}, in.Status) {
		return out, model.Invalid("status", "任务状态须为open或done。")
	}
	if in.Kind != "" && !slices.Contains([]string{"approval", "travel", "expense"}, in.Kind) {
		return out, model.Invalid("kind", "任务来源无效。")
	}
	for _, field := range []struct{ name, value string }{{"from", in.From}, {"to", in.To}} {
		if field.value != "" {
			if _, err := time.Parse("2006-01-02", field.value); err != nil {
				return out, model.Invalid(field.name, "日期须为有效YYYY-MM-DD。")
			}
		}
	}
	if in.From != "" && in.To != "" && in.From > in.To {
		return out, model.Invalid("to", "结束日期不能早于开始日期。")
	}
	q := model.BusinessQuery{ExpectedGeneration: in.ExpectedGeneration, ActorID: in.ActorID, Query: in.Query, Page: in.Page, PageSize: in.PageSize}
	return s.queryTasks(ctx, a, q, in.Status, in.Kind, in.From, in.To)
}
func (s *Sessions) queryTasks(ctx context.Context, a model.Access, q model.BusinessQuery, status, kind, from, to string) (model.BusinessPage[model.BusinessTask], error) {
	var out model.BusinessPage[model.BusinessTask]
	if err := businessAccess(a, "business:read", q.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := queryDefaults(&q); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, q.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(q.ActorID)
		if err != nil {
			return err
		}
		items, err := b.Tasks(actor, status, "", "")
		if err != nil {
			return err
		}
		filtered := []model.BusinessTask{}
		zone := time.FixedZone("Asia/Shanghai", 8*3600)
		for _, task := range items {
			if kind != "" && task.SourceType != kind {
				continue
			}
			if !matches(q, task.SourceStatus, task.Title+" "+task.SourceID) {
				continue
			}
			if from != "" || to != "" {
				at := task.DueAt
				if status == "done" && task.CompletedAt != nil {
					at = *task.CompletedAt
				}
				parsed, err := time.Parse(time.RFC3339, at)
				if err != nil {
					return err
				}
				date := parsed.In(zone).Format("2006-01-02")
				if from != "" && date < from || to != "" && date > to {
					continue
				}
			}
			filtered = append(filtered, task)
		}
		out = page(filtered, q, b)
		return nil
	})
	return out, err
}
func (s *Sessions) Workbench(ctx context.Context, a model.Access, q model.BusinessQuery) (model.WorkbenchSummary, error) {
	var out model.WorkbenchSummary
	if err := businessAccess(a, "business:read", q.ExpectedGeneration); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, q.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(q.ActorID)
		if err != nil {
			return err
		}
		items, err := b.Tasks(actor, "", "", "")
		if err != nil {
			return err
		}
		out.Generation = b.Session.Generation
		out.Revision = b.Session.Revision
		for _, t := range items {
			if t.Status == "done" {
				out.Done++
			} else {
				out.Pending++
				due, _ := time.Parse(time.RFC3339, t.DueAt)
				if due.Before(b.Now) {
					out.Overdue++
				}
			}
		}
		return nil
	})
	return out, err
}
func (s *Sessions) Approvals(ctx context.Context, a model.Access, q model.BusinessQuery) (model.BusinessPage[model.Approval], error) {
	var out model.BusinessPage[model.Approval]
	if err := businessAccess(a, "business:read", q.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := queryDefaults(&q); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, q.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(q.ActorID)
		if err != nil {
			return err
		}
		ids, err := b.IDs("approval", actor.ID)
		if err != nil {
			return err
		}
		items := []model.Approval{}
		for _, id := range ids {
			v, err := b.Approval(id)
			if err != nil {
				return err
			}
			if matches(q, v.Status, v.Title+" "+v.ID) {
				items = append(items, v)
			}
		}
		out = page(items, q, b)
		return nil
	})
	return out, err
}
func (s *Sessions) ApprovalRead(ctx context.Context, a model.Access, in model.BusinessRead) (model.BusinessDetail[model.Approval], error) {
	var out model.BusinessDetail[model.Approval]
	if err := businessAccess(a, "business:read", in.ExpectedGeneration); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		v, err := b.Approval(in.ID)
		if err != nil {
			return err
		}
		if err = canRead(actor, v.ApplicantID, v.ReviewerID); err != nil {
			return err
		}
		out.Decisions, err = b.ApprovalDecisions(v.ID)
		if err != nil {
			return err
		}
		out.Item = v
		out.Generation = b.Session.Generation
		out.Revision = b.Session.Revision
		out.Tasks, err = b.Tasks(model.Employee{ID: v.ReviewerID, DepartmentID: v.DepartmentID}, "", "approval", v.ID)
		if err != nil {
			return err
		}
		out.History, err = b.History("approval", v.ID)
		return err
	})
	return out, err
}
func (s *Sessions) ApprovalMaterials(ctx context.Context, a model.Access, in model.GenerationInput) ([]model.BusinessMaterial, error) {
	out := []model.BusinessMaterial{}
	if err := businessAccess(a, "business:read", in.ExpectedGeneration); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error { var err error; out, err = b.Materials(); return err })
	return out, err
}
func (s *Sessions) ApprovalSubmit(ctx context.Context, a model.Access, in model.ApprovalSubmit) (model.BusinessResult, error) {
	var out model.BusinessResult
	if err := businessAccess(a, "business:write", in.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := validateMutation(in.BusinessMutation); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		fp := fingerprint(in)
		replay, err := b.Replay(in.IdempotencyKey, "approval_submit", fp)
		if err != nil {
			return err
		}
		if replay != nil {
			out = *replay
			return nil
		}
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		if !role(actor, "employee") {
			return model.Invalid("actorId", "只有在职员工可以提交。")
		}
		if err = bounded("title", in.Title, 120); err != nil {
			return err
		}
		if err = bounded("description", in.Description, 2000); err != nil {
			return err
		}
		materials, err := b.Materials()
		if err != nil {
			return err
		}
		if len(in.MaterialIDs) < 1 || len(in.MaterialIDs) > 10 {
			return model.Invalid("materialIds", "请选择1～10份资料。")
		}
		seen := map[string]bool{}
		for _, id := range in.MaterialIDs {
			if seen[id] || !slices.ContainsFunc(materials, func(m model.BusinessMaterial) bool { return m.ID == id }) {
				return model.Invalid("materialIds", "资料不存在或重复。")
			}
			seen[id] = true
		}
		var v model.Approval
		var from *string
		if in.RequestID == nil {
			if in.ExpectedVersion != 0 {
				return model.Invalid("expectedVersion", "新申请的版本须为0。")
			}
			id, err := b.NextID("APPR", "approval_requests")
			if err != nil {
				return err
			}
			v = model.Approval{ID: id, ApplicantID: actor.ID, DepartmentID: actor.DepartmentID, CreatedAt: b.Now.UTC().Format(time.RFC3339)}
		} else {
			v, err = b.Approval(*in.RequestID)
			if err != nil {
				return err
			}
			if v.ApplicantID != actor.ID {
				return model.Failure(403, "action.forbidden", "只有原申请人可以重新提交。")
			}
			if v.Status != "returned" && v.Status != "withdrawn" {
				return model.Invalid("requestId", "只有退回或撤回申请可以重新提交。")
			}
			if err = version(v.BusinessVersion, in.ExpectedVersion); err != nil {
				return err
			}
			from = pointer(v.Status)
		}
		v.ReviewerID, err = b.Manager(v.DepartmentID, actor.ID)
		if err != nil {
			return err
		}
		v.Title = strings.TrimSpace(in.Title)
		v.Description = strings.TrimSpace(in.Description)
		v.MaterialIDs = in.MaterialIDs
		v.Status = "submitted"
		v.BusinessVersion++
		v.CurrentTaskID, err = b.NewTask("approval", v.ID, "审批"+v.Title, v.ReviewerID)
		if err != nil {
			return err
		}
		if err = b.SaveApproval(v); err != nil {
			return err
		}
		if err = b.Audit("approval", v.ID, "submit", actor.ID, from, v.Status, v.BusinessVersion, ""); err != nil {
			return err
		}
		out, err = b.CommitResult("approval", "approval_submit", in.IdempotencyKey, fp, actor.ID, v.ID, v.Status, v.BusinessVersion, v.CurrentTaskID)
		return err
	})
	return out, err
}
func (s *Sessions) ApprovalDecision(ctx context.Context, a model.Access, in model.BusinessDecision, action string) (model.BusinessResult, error) {
	var out model.BusinessResult
	if err := businessAccess(a, "business:write", in.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := validateMutation(in.BusinessMutation); err != nil {
		return out, err
	}
	if !slices.Contains([]string{"approve", "return", "withdraw"}, action) {
		return out, model.Invalid("action", "操作无效。")
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		op := "approval_" + action
		fp := fingerprint(in)
		replay, err := b.Replay(in.IdempotencyKey, op, fp)
		if err != nil {
			return err
		}
		if replay != nil {
			out = *replay
			return nil
		}
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		v, err := b.Approval(in.ID)
		if err != nil {
			return err
		}
		if err = version(v.BusinessVersion, in.ExpectedVersion); err != nil {
			return err
		}
		if v.Status != "submitted" || v.CurrentTaskID == nil {
			return model.Failure(409, "action.invalid-transition", "当前申请不是待审批状态。")
		}
		if action == "withdraw" {
			if actor.ID != v.ApplicantID {
				return model.Failure(403, "action.forbidden", "只有申请人可以撤回。")
			}
		} else if actor.ID != v.ReviewerID || actor.DepartmentID != v.DepartmentID || !role(actor, "manager") {
			return model.Failure(403, "action.forbidden", "只有指定同部门主管可以审批。")
		}
		if err = bounded("opinion", in.Opinion, 200); err != nil {
			return err
		}
		if err = b.CloseTask("approval", v.ID, *v.CurrentTaskID, actor.ID, action); err != nil {
			return err
		}
		if err = b.RecordApprovalDecision(v.ID, *v.CurrentTaskID, action, actor.ID, strings.TrimSpace(in.Opinion), v.BusinessVersion+1); err != nil {
			return err
		}
		v.Status = map[string]string{"approve": "approved", "return": "returned", "withdraw": "withdrawn"}[action]
		v.BusinessVersion++
		v.CurrentTaskID = nil
		if err = b.SaveApproval(v); err != nil {
			return err
		}
		if err = b.Audit("approval", v.ID, action, actor.ID, pointer("submitted"), v.Status, v.BusinessVersion, strings.TrimSpace(in.Opinion)); err != nil {
			return err
		}
		out, err = b.CommitResult("approval", op, in.IdempotencyKey, fp, actor.ID, v.ID, v.Status, v.BusinessVersion, nil)
		return err
	})
	return out, err
}
func (s *Sessions) Travels(ctx context.Context, a model.Access, q model.BusinessQuery) (model.BusinessPage[model.Travel], error) {
	var out model.BusinessPage[model.Travel]
	if err := businessAccess(a, "business:read", q.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := queryDefaults(&q); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, q.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(q.ActorID)
		if err != nil {
			return err
		}
		ids, err := b.IDs("travel", actor.ID)
		if err != nil {
			return err
		}
		items := []model.Travel{}
		for _, id := range ids {
			v, err := b.Travel(id)
			if err != nil {
				return err
			}
			if matches(q, v.Status, v.Origin+" "+v.Destination+" "+v.ID) {
				items = append(items, v)
			}
		}
		out = page(items, q, b)
		return nil
	})
	return out, err
}
func (s *Sessions) TravelRead(ctx context.Context, a model.Access, in model.BusinessRead) (model.BusinessDetail[model.Travel], error) {
	var out model.BusinessDetail[model.Travel]
	if err := businessAccess(a, "business:read", in.ExpectedGeneration); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		v, err := b.Travel(in.ID)
		if err != nil {
			return err
		}
		if err = canRead(actor, v.ApplicantID, v.ReviewerID); err != nil {
			return err
		}
		if v.Status == "draft" {
			out.Assets, err = b.DraftAssets(v.ID)
			if err != nil {
				return err
			}
		}
		out.Item = v
		out.Generation = b.Session.Generation
		out.Revision = b.Session.Revision
		out.Tasks, err = b.Tasks(model.Employee{ID: v.ReviewerID, DepartmentID: v.DepartmentID}, "", "travel", v.ID)
		if err != nil {
			return err
		}
		out.History, err = b.History("travel", v.ID)
		return err
	})
	return out, err
}
func (s *Sessions) TravelSubmit(ctx context.Context, a model.Access, in model.TravelSubmit) (model.BusinessResult, error) {
	var out model.BusinessResult
	if err := businessAccess(a, "business:write", in.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := validateMutation(in.BusinessMutation); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		fp := fingerprint(in)
		replay, err := b.Replay(in.IdempotencyKey, "travel_submit", fp)
		if err != nil {
			return err
		}
		if replay != nil {
			out = *replay
			return nil
		}
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		if !role(actor, "employee") {
			return model.Invalid("actorId", "申请人必须是在职员工。")
		}
		if actor.DepartmentID != in.DepartmentID {
			return model.Invalid("departmentId", "部门必须与申请人一致。")
		}
		if in.ExpectedVersion != 0 {
			return model.Invalid("expectedVersion", "新申请版本须为0。")
		}
		if len(in.TravelerIDs) < 1 || len(in.TravelerIDs) > 10 || !slices.Contains(in.TravelerIDs, actor.ID) {
			return model.Invalid("travelerIds", "选择1～10位同行人员并包含申请人。")
		}
		seen := map[string]bool{}
		for _, id := range in.TravelerIDs {
			e, err := b.Employee(id)
			if err != nil {
				return model.Invalid("travelerIds", "同行人员不存在或停用。")
			}
			if seen[id] || e.DepartmentID != actor.DepartmentID {
				return model.Invalid("travelerIds", "同行人员不能重复且必须同部门。")
			}
			seen[id] = true
		}
		if err = bounded("origin", in.Origin, 80); err != nil {
			return err
		}
		if err = bounded("destination", in.Destination, 80); err != nil {
			return err
		}
		if strings.TrimSpace(in.Origin) == strings.TrimSpace(in.Destination) {
			return model.Invalid("destination", "目的地不能与出发地相同。")
		}
		start, err := time.Parse(time.RFC3339, in.StartAt)
		if err != nil || start.Before(b.Now) {
			return model.Invalid("startAt", "开始时间必须为有效未来时间。")
		}
		end, err := time.Parse(time.RFC3339, in.EndAt)
		if err != nil || !end.After(start) {
			return model.Invalid("endAt", "结束时间须晚于开始时间。")
		}
		if in.EstimatedAmountCents <= 0 || in.EstimatedAmountCents > 9007199254740991 {
			return model.Invalid("estimatedAmountCents", "预计金额必须为安全的正整数分。")
		}
		reviewer, err := b.Manager(actor.DepartmentID, actor.ID)
		if err != nil {
			return err
		}
		id, err := b.NextID("FORM", "business_forms")
		if err != nil {
			return err
		}
		v := model.Travel{Form: model.Form{ID: id, Kind: "travel", ApplicantID: actor.ID, DepartmentID: actor.DepartmentID, ReviewerID: reviewer, Status: "submitted", BusinessVersion: 1, AmountCents: in.EstimatedAmountCents, CreatedAt: b.Now.UTC().Format(time.RFC3339)}, Origin: strings.TrimSpace(in.Origin), Destination: strings.TrimSpace(in.Destination), StartAt: start.UTC().Format(time.RFC3339), EndAt: end.UTC().Format(time.RFC3339), TravelerIDs: in.TravelerIDs}
		v.CurrentTaskID, err = b.NewTask("travel", v.ID, "审批差旅："+v.Destination, reviewer)
		if err != nil {
			return err
		}
		if err = b.SaveTravel(v); err != nil {
			return err
		}
		if err = b.Audit("travel", v.ID, "submit", actor.ID, nil, v.Status, 1, ""); err != nil {
			return err
		}
		out, err = b.CommitResult("travel", "travel_submit", in.IdempotencyKey, fp, actor.ID, v.ID, v.Status, 1, v.CurrentTaskID)
		return err
	})
	return out, err
}
func (s *Sessions) Expenses(ctx context.Context, a model.Access, q model.BusinessQuery) (model.BusinessPage[model.Expense], error) {
	var out model.BusinessPage[model.Expense]
	if err := businessAccess(a, "business:read", q.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := queryDefaults(&q); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, q.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(q.ActorID)
		if err != nil {
			return err
		}
		ids, err := b.IDs("expense", actor.ID)
		if err != nil {
			return err
		}
		items := []model.Expense{}
		for _, id := range ids {
			v, err := b.Expense(id)
			if err != nil {
				return err
			}
			if matches(q, v.Status, v.TravelFormID+" "+v.ID) {
				items = append(items, v)
			}
		}
		out = page(items, q, b)
		return nil
	})
	return out, err
}
func (s *Sessions) ExpenseRead(ctx context.Context, a model.Access, in model.BusinessRead) (model.BusinessDetail[model.Expense], error) {
	var out model.BusinessDetail[model.Expense]
	if err := businessAccess(a, "business:read", in.ExpectedGeneration); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		v, err := b.Expense(in.ID)
		if err != nil {
			return err
		}
		if err = canRead(actor, v.ApplicantID, v.ReviewerID); err != nil {
			return err
		}
		out.Item = v
		out.Generation = b.Session.Generation
		out.Revision = b.Session.Revision
		out.Tasks, err = b.Tasks(model.Employee{ID: v.ReviewerID, DepartmentID: v.DepartmentID}, "", "expense", v.ID)
		if err != nil {
			return err
		}
		out.History, err = b.History("expense", v.ID)
		return err
	})
	return out, err
}
func (s *Sessions) FormDecision(ctx context.Context, a model.Access, in model.BusinessDecision, kind, action string) (model.BusinessResult, error) {
	var out model.BusinessResult
	if err := businessAccess(a, "business:write", in.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := validateMutation(in.BusinessMutation); err != nil {
		return out, err
	}
	if !slices.Contains([]string{"travel", "expense"}, kind) || !slices.Contains([]string{"submit", "approve", "return"}, action) {
		return out, model.Invalid("action", "操作无效。")
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		op := kind + "_" + action
		if kind == "travel" && action == "submit" {
			op = "travel_resubmit"
		}
		fp := fingerprint(in)
		replay, err := b.Replay(in.IdempotencyKey, op, fp)
		if err != nil {
			return err
		}
		if replay != nil {
			out = *replay
			return nil
		}
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		v, err := b.Form(in.ID)
		if err != nil {
			return err
		}
		if v.Kind != kind {
			return model.Invalid("id", "单据类型不匹配。")
		}
		if err = version(v.BusinessVersion, in.ExpectedVersion); err != nil {
			return err
		}
		from := v.Status
		if action == "submit" {
			if actor.ID != v.ApplicantID || !role(actor, "employee") {
				return model.Failure(403, "action.forbidden", "只有原申请人可以提交。")
			}
			if v.Status != "returned" && (v.Status != "draft" || kind != "expense") {
				return model.Failure(409, "action.invalid-transition", "当前状态不可提交。")
			}
			if kind == "expense" {
				e, err := b.Expense(v.ID)
				if err != nil {
					return err
				}
				if e.CheckedVersion != v.BusinessVersion {
					return model.Invalid("id", "费用明细未按当前版本校验。")
				}
			}
			v.ReviewerID, err = b.Manager(v.DepartmentID, actor.ID)
			if err != nil {
				return err
			}
			v.Status = "submitted"
			v.CurrentTaskID, err = b.NewTask(kind, v.ID, "审批"+kind, v.ReviewerID)
			if err != nil {
				return err
			}
		} else {
			if v.Status != "submitted" || v.CurrentTaskID == nil {
				return model.Failure(409, "action.invalid-transition", "当前状态不可审批。")
			}
			if actor.ID != v.ReviewerID || actor.ID == v.ApplicantID || actor.DepartmentID != v.DepartmentID || !role(actor, "manager") {
				return model.Failure(403, "action.forbidden", "只有指定同部门主管可以审批。")
			}
			if err = bounded("opinion", in.Opinion, 200); err != nil {
				return err
			}
			if err = b.CloseTask(kind, v.ID, *v.CurrentTaskID, actor.ID, action); err != nil {
				return err
			}
			v.CurrentTaskID = nil
			v.Status = map[string]string{"approve": "approved", "return": "returned"}[action]
		}
		v.BusinessVersion++
		if err = b.SaveForm(v); err != nil {
			return err
		}
		if err = b.Audit(kind, v.ID, action, actor.ID, pointer(from), v.Status, v.BusinessVersion, strings.TrimSpace(in.Opinion)); err != nil {
			return err
		}
		out, err = b.CommitResult(kind, op, in.IdempotencyKey, fp, actor.ID, v.ID, v.Status, v.BusinessVersion, v.CurrentTaskID)
		return err
	})
	return out, err
}

func (s *Sessions) TravelAssets(ctx context.Context, a model.Access, in model.BusinessRead) ([]model.BusinessAsset, error) {
	out := []model.BusinessAsset{}
	if err := businessAccess(a, "business:read", in.ExpectedGeneration); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		v, err := b.Travel(in.ID)
		if err != nil {
			return err
		}
		if err = canRead(actor, v.ApplicantID, v.ReviewerID); err != nil {
			return err
		}
		out, err = b.Assets(v.ID)
		return err
	})
	return out, err
}

// Register metadata for a fictional receipt. This does not upload a real file.
func (s *Sessions) TravelAssetRegister(ctx context.Context, a model.Access, in model.AssetRegister) (model.BusinessResult, error) {
	var out model.BusinessResult
	if err := businessAccess(a, "business:write", in.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := validateMutation(in.BusinessMutation); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		fp := fingerprint(in)
		replay, err := b.Replay(in.IdempotencyKey, "travel_receipt_register", fp)
		if err != nil {
			return err
		}
		if replay != nil {
			out = *replay
			return nil
		}
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		v, err := b.Travel(in.TravelFormID)
		if err != nil {
			return err
		}
		if actor.ID != v.ApplicantID || !role(actor, "employee") {
			return model.Failure(403, "action.forbidden", "只有差旅申请人可以登记票据。")
		}
		if err = version(v.BusinessVersion, in.ExpectedVersion); err != nil {
			return err
		}
		if err = bounded("filename", in.Filename, 120); err != nil {
			return err
		}
		id, err := b.NextID("AST", "business_assets")
		if err != nil {
			return err
		}
		if err = b.Exec(`INSERT INTO business_assets VALUES(?,?,?,?)`, b.Session.ID, id, v.ID, strings.TrimSpace(in.Filename)); err != nil {
			return err
		}
		if err = b.Audit("travel", v.ID, "receipt-register", actor.ID, pointer(v.Status), v.Status, v.BusinessVersion, id); err != nil {
			return err
		}
		out, err = b.CommitResult("travel", "travel_receipt_register", in.IdempotencyKey, fp, actor.ID, id, "registered", v.BusinessVersion, nil)
		return err
	})
	return out, err
}
func (s *Sessions) ExpenseCheck(ctx context.Context, a model.Access, in model.ExpenseCheck, correct bool) (model.BusinessResult, error) {
	var out model.BusinessResult
	if err := businessAccess(a, "business:write", in.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := validateMutation(in.BusinessMutation); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		op := "expense_check"
		if correct {
			op = "expense_correct"
		}
		fp := fingerprint(in)
		replay, err := b.Replay(in.IdempotencyKey, op, fp)
		if err != nil {
			return err
		}
		if replay != nil {
			out = *replay
			return nil
		}
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		trip, err := b.Travel(in.TravelFormID)
		if err != nil {
			return err
		}
		if trip.Status != "submitted" && trip.Status != "approved" {
			return model.Invalid("travelFormId", "差旅申请尚未提交或已退回。")
		}
		if actor.ID != trip.ApplicantID || !role(actor, "employee") {
			return model.Failure(403, "action.forbidden", "只有差旅申请人可以核验费用。")
		}
		var v model.Expense
		var from *string
		if correct {
			if in.ExpenseFormID == "" {
				return model.Invalid("expenseFormId", "缺少补正单据。")
			}
			v, err = b.Expense(in.ExpenseFormID)
			if err != nil {
				return err
			}
			if v.ApplicantID != actor.ID {
				return model.Failure(403, "action.forbidden", "只有原申请人可以补正。")
			}
			if v.Status != "returned" || v.TravelFormID != trip.ID {
				return model.Invalid("expenseFormId", "只有退回单可补正，且关联差旅不能变更。")
			}
			if err = version(v.BusinessVersion, in.ExpectedVersion); err != nil {
				return err
			}
			from = pointer(v.Status)
			v.BusinessVersion++
		} else {
			if in.ExpectedVersion != 0 || in.ExpenseFormID != "" {
				return model.Invalid("expectedVersion", "新费用校验的版本须为0且不指定费用单。")
			}
			id, err := b.NextID("FORM", "business_forms")
			if err != nil {
				return err
			}
			v = model.Expense{Form: model.Form{ID: id, Kind: "expense", ApplicantID: actor.ID, DepartmentID: trip.DepartmentID, ReviewerID: trip.ReviewerID, Status: "draft", BusinessVersion: 1, CreatedAt: b.Now.UTC().Format(time.RFC3339)}, TravelFormID: trip.ID}
		}
		if err = checkExpense(b, in, v.ID); err != nil {
			return err
		}
		v.AmountCents = in.DeclaredTotalCents
		v.CheckedVersion = v.BusinessVersion
		v.Receipts = in.Receipts
		v.LineItems = in.LineItems
		if err = b.SaveExpense(v); err != nil {
			return err
		}
		if err = b.Audit("expense", v.ID, op, actor.ID, from, v.Status, v.BusinessVersion, ""); err != nil {
			return err
		}
		out, err = b.CommitResult("expense", op, in.IdempotencyKey, fp, actor.ID, v.ID, v.Status, v.BusinessVersion, v.CurrentTaskID)
		return err
	})
	return out, err
}
func checkExpense(b *repository.BusinessTx, in model.ExpenseCheck, exclude string) error {
	if len(in.Receipts) < 1 || len(in.Receipts) > 20 {
		return model.Invalid("receipts", "请选择1～20张票据。")
	}
	if len(in.LineItems) < 1 || len(in.LineItems) > 40 {
		return model.Invalid("lineItems", "请选择1～40条明细。")
	}
	const maxAmount int64 = 9007199254740991
	if in.DeclaredTotalCents <= 0 || in.DeclaredTotalCents > maxAmount {
		return model.Invalid("declaredTotalCents", "总额必须是安全的正整数分。")
	}
	assets, err := b.Assets(in.TravelFormID)
	if err != nil {
		return err
	}
	invoices := map[string]int64{}
	seenAssets := map[string]bool{}
	var receiptSum, lineSum int64
	for _, r := range in.Receipts {
		if err = bounded("receipts", r.InvoiceNo, 64); err != nil {
			return err
		}
		if strings.TrimSpace(r.InvoiceNo) != r.InvoiceNo {
			return model.Invalid("receipts", "票据编号不能有首尾空格。")
		}
		if _, seen := invoices[r.InvoiceNo]; seen || seenAssets[r.AssetID] {
			return model.Invalid("receipts", "票据或附件重复。")
		}
		if !slices.ContainsFunc(assets, func(a model.BusinessAsset) bool { return a.ID == r.AssetID }) {
			return model.Invalid("receipts", "票据附件未关联此差旅。")
		}
		var used int
		if err = b.Tx.QueryRowContext(b.Context, `SELECT count(*) FROM expense_receipts WHERE session_id=? AND form_id<>? AND (invoice_no=? OR asset_id=?)`, b.Session.ID, exclude, r.InvoiceNo, r.AssetID).Scan(&used); err != nil {
			return err
		}
		if used > 0 {
			return model.Invalid("receipts", "票据编号或附件已用于其他报销。")
		}
		if r.AmountCents <= 0 || r.AmountCents > maxAmount || receiptSum > maxAmount-r.AmountCents {
			return model.Invalid("receipts", "票据金额无效或总额超限。")
		}
		invoices[r.InvoiceNo] = r.AmountCents
		seenAssets[r.AssetID] = true
		receiptSum += r.AmountCents
	}
	perInvoice := map[string]int64{}
	for _, l := range in.LineItems {
		if !slices.Contains([]string{"transport", "hotel", "meal", "other"}, l.Category) {
			return model.Invalid("lineItems", "费用类别无效。")
		}
		if _, ok := invoices[l.InvoiceNo]; !ok {
			return model.Invalid("lineItems", "明细未关联本次票据。")
		}
		if l.AmountCents <= 0 || l.AmountCents > maxAmount || lineSum > maxAmount-l.AmountCents {
			return model.Invalid("lineItems", "明细金额无效或总额超限。")
		}
		lineSum += l.AmountCents
		perInvoice[l.InvoiceNo] += l.AmountCents
	}
	if lineSum != in.DeclaredTotalCents || receiptSum != in.DeclaredTotalCents {
		return model.Invalid("declaredTotalCents", "总额须与票据及明细金额一致。")
	}
	for id, amount := range invoices {
		if perInvoice[id] != amount {
			return model.Invalid("receipts", "每张票据金额须与其明细合计一致。")
		}
	}
	return nil
}

func (s *Sessions) TodoComplete(ctx context.Context, a model.Access, in model.TodoComplete) (model.BusinessResult, error) {
	var task model.BusinessTask
	if err := businessAccess(a, "business:write", in.ExpectedGeneration); err != nil {
		return model.BusinessResult{}, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		items, err := b.Tasks(actor, "", "", "")
		if err != nil {
			return err
		}
		for _, t := range items {
			if t.ID == in.TodoID {
				task = t
				return nil
			}
		}
		return model.Failure(404, "action.todo-not-found", "待办不存在或不可见。")
	})
	if err != nil {
		return model.BusinessResult{}, err
	}
	if task.SourceType != "travel" {
		return model.BusinessResult{}, model.Invalid("todoId", "此待办须使用对应审批工具办理。")
	}
	// The immutable task source is resolved first; FormDecision rechecks version,
	// assigned actor and the current open task inside the write transaction.
	return s.FormDecision(ctx, a, model.BusinessDecision{BusinessMutation: in.BusinessMutation, ID: task.SourceID, Opinion: "完成待办"}, "travel", "approve")
}
func (s *Sessions) TodoSummarize(ctx context.Context, a model.Access, in model.TodoSummaryInput) (model.TodoSummary, error) {
	out := model.TodoSummary{Date: in.Date, ActorID: in.ActorID, Items: []model.TodoSummaryItem{}}
	if err := businessAccess(a, "business:read", in.ExpectedGeneration); err != nil {
		return out, err
	}
	if _, err := time.Parse("2006-01-02", in.Date); err != nil {
		return out, model.Invalid("date", "日期须为有效YYYY-MM-DD。")
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		items, err := b.Tasks(actor, "", "", "")
		if err != nil {
			return err
		}
		zone := time.FixedZone("Asia/Shanghai", 8*3600)
		for _, t := range items {
			at := t.DueAt
			if t.Status == "done" && t.CompletedAt != nil {
				at = *t.CompletedAt
			}
			date, err := time.Parse(time.RFC3339, at)
			if err != nil {
				return err
			}
			if date.In(zone).Format("2006-01-02") != in.Date {
				continue
			}
			category := "pending"
			if t.Status == "done" {
				category = "done"
				out.Done++
			} else if date.Before(b.Now) {
				category = "overdue"
				out.Overdue++
			} else {
				out.Pending++
			}
			out.Items = append(out.Items, model.TodoSummaryItem{TodoID: t.ID, SourceID: t.SourceID, Category: category, DueAt: t.DueAt, CompletedAt: t.CompletedAt})
		}
		return nil
	})
	return out, err
}

func (s *Sessions) TravelDraftSave(ctx context.Context, a model.Access, in model.TravelDraft) (model.BusinessResult, error) {
	var out model.BusinessResult
	if err := businessAccess(a, "business:write", in.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := validateMutation(in.BusinessMutation); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		fp := fingerprint(in)
		replay, err := b.Replay(in.IdempotencyKey, "travel_draft_save", fp)
		if err != nil {
			return err
		}
		if replay != nil {
			out = *replay
			return nil
		}
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		v, err := b.Form(in.FormID)
		if err != nil {
			return err
		}
		if v.Kind != "travel" || v.Status != "draft" {
			return model.Invalid("formId", "只有差旅草稿可以编辑。")
		}
		if actor.ID != v.ApplicantID {
			return model.Failure(403, "action.forbidden", "只有原申请人可以编辑草稿。")
		}
		if err = version(v.BusinessVersion, in.ExpectedVersion); err != nil {
			return err
		}
		applicant, err := b.Employee(in.ApplicantID)
		if err != nil {
			return model.Invalid("applicantId", "申请人不存在或停用。")
		}
		if applicant.DepartmentID != in.DepartmentID {
			return model.Invalid("departmentId", "申请人与部门不匹配。")
		}
		if in.AmountCents < 0 || in.AmountCents > 9007199254740991 {
			return model.Invalid("amountCents", "金额须为安全非负整数分。")
		}
		seen := map[string]bool{}
		for _, id := range in.AssetIDs {
			var owner *string
			if err = b.Tx.QueryRowContext(b.Context, `SELECT owner_id FROM business_assets WHERE session_id=? AND id=?`, b.Session.ID, id).Scan(&owner); err != nil {
				return model.Invalid("assetIds", "附件不存在。")
			}
			if seen[id] || owner != nil && *owner != v.ID {
				return model.Invalid("assetIds", "附件重复或已关联其他单据。")
			}
			seen[id] = true
		}
		v.ApplicantID = applicant.ID
		v.DepartmentID = applicant.DepartmentID
		v.AmountCents = in.AmountCents
		v.BusinessVersion++
		v.ReviewerID, err = b.Manager(v.DepartmentID, v.ApplicantID)
		if err != nil {
			return err
		}
		if err = b.SaveForm(v); err != nil {
			return err
		}
		if err = b.Exec(`UPDATE business_assets SET owner_id=NULL WHERE session_id=? AND owner_id=?`, b.Session.ID, v.ID); err != nil {
			return err
		}
		for _, id := range in.AssetIDs {
			if err = b.Exec(`UPDATE business_assets SET owner_id=? WHERE session_id=? AND id=?`, v.ID, b.Session.ID, id); err != nil {
				return err
			}
		}
		if err = b.Audit("travel", v.ID, "save-draft", actor.ID, pointer("draft"), "draft", v.BusinessVersion, ""); err != nil {
			return err
		}
		out, err = b.CommitResult("travel", "travel_draft_save", in.IdempotencyKey, fp, actor.ID, v.ID, v.Status, v.BusinessVersion, nil)
		return err
	})
	return out, err
}

func approvalRecord(v model.Approval) model.BusinessRecord {
	return model.BusinessRecord{ID: v.ID, Kind: "approval", ApplicantID: v.ApplicantID, DepartmentID: v.DepartmentID, ReviewerID: v.ReviewerID, Title: v.Title, Status: v.Status, BusinessVersion: v.BusinessVersion, CurrentTaskID: v.CurrentTaskID, CreatedAt: v.CreatedAt, Description: v.Description, MaterialIDs: v.MaterialIDs}
}
func formRecord(v model.Form) model.BusinessRecord {
	return model.BusinessRecord{ID: v.ID, Kind: v.Kind, ApplicantID: v.ApplicantID, DepartmentID: v.DepartmentID, ReviewerID: v.ReviewerID, Status: v.Status, BusinessVersion: v.BusinessVersion, CurrentTaskID: v.CurrentTaskID, CreatedAt: v.CreatedAt, AmountCents: &v.AmountCents}
}
func travelRecord(v model.Travel) model.BusinessRecord {
	r := formRecord(v.Form)
	r.Title = "差旅：" + v.Origin + " → " + v.Destination
	r.Origin = v.Origin
	r.Destination = v.Destination
	r.StartAt = v.StartAt
	r.EndAt = v.EndAt
	r.TravelerIDs = v.TravelerIDs
	return r
}
func expenseRecord(v model.Expense) model.BusinessRecord {
	r := formRecord(v.Form)
	r.Title = "报销：" + v.TravelFormID
	r.TravelFormID = v.TravelFormID
	r.CheckedVersion = &v.CheckedVersion
	r.Receipts = v.Receipts
	r.LineItems = v.LineItems
	return r
}

// Records queries one authorized workspace snapshot. Detail metadata, materials
// and receipt options are read in the same transaction as the source record.
func (s *Sessions) Records(ctx context.Context, a model.Access, in model.RecordQuery) (model.RecordsPage, error) {
	out := model.RecordsPage{Kind: in.Kind, Items: []model.BusinessRecord{}}
	if err := businessAccess(a, "business:read", in.ExpectedGeneration); err != nil {
		return out, err
	}
	if !slices.Contains([]string{"approval", "travel", "expense"}, in.Kind) {
		return out, model.Invalid("kind", "单据类型无效。")
	}
	if in.ID != "" && (in.Query != "" || in.Status != "" || in.Page != 0 || in.PageSize != 0) {
		return out, model.Invalid("id", "详情查询不能同时传列表筛选或分页。")
	}
	q := in.BusinessQuery
	if err := queryDefaults(&q); err != nil {
		return out, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		ids := []string{in.ID}
		if in.ID == "" {
			ids, err = b.IDs(in.Kind, actor.ID)
			if err != nil {
				return err
			}
		}
		items := []model.BusinessRecord{}
		for _, id := range ids {
			var r model.BusinessRecord
			switch in.Kind {
			case "approval":
				v, err := b.Approval(id)
				if err != nil {
					return err
				}
				r = approvalRecord(v)
			case "travel":
				v, err := b.Travel(id)
				if err != nil {
					return err
				}
				r = travelRecord(v)
			case "expense":
				v, err := b.Expense(id)
				if err != nil {
					return err
				}
				r = expenseRecord(v)
			}
			if err = canRead(actor, r.ApplicantID, r.ReviewerID); err != nil {
				return err
			}
			if in.ID == "" && !matches(q, r.Status, r.Title+" "+r.ID) {
				continue
			}
			if in.ID != "" {
				r.Tasks, err = b.Tasks(model.Employee{ID: r.ReviewerID, DepartmentID: r.DepartmentID}, "", in.Kind, id)
				if err != nil {
					return err
				}
				r.History, err = b.History(in.Kind, id)
				if err != nil {
					return err
				}
				if in.Kind == "approval" {
					r.Decisions, err = b.ApprovalDecisions(id)
					if err != nil {
						return err
					}
				}
				if in.Kind == "travel" {
					if r.Status == "draft" {
						r.Assets, err = b.DraftAssets(id)
					} else {
						r.Assets, err = b.Assets(id)
					}
					if err != nil {
						return err
					}
				}
			}
			items = append(items, r)
		}
		if in.ID != "" {
			q.Page = 1
			q.PageSize = 1
		}
		paged := page(items, q, b)
		out.Items = paged.Items
		out.Total = paged.Total
		out.Page = paged.Page
		out.PageSize = paged.PageSize
		out.Generation = paged.Generation
		out.Revision = paged.Revision
		if in.Kind == "approval" {
			out.Materials, err = b.Materials()
			if err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}

// Each call delegates one explicit operation to a domain service. Domain
// workflows, role checks and atomic effects are not replaced by a generic state setter.
func (s *Sessions) Transition(ctx context.Context, a model.Access, in model.WorkflowTransition) (model.BusinessResult, error) {
	switch in.Kind {
	case "approval":
		return s.ApprovalDecision(ctx, a, in.BusinessDecision, in.Action)
	case "travel":
		if in.Action == "resubmit" {
			return s.FormDecision(ctx, a, in.BusinessDecision, "travel", "submit")
		}
		if in.Action != "approve" && in.Action != "return" {
			return model.BusinessResult{}, model.Invalid("action", "差旅只支持approve、return和resubmit。")
		}
		return s.FormDecision(ctx, a, in.BusinessDecision, "travel", in.Action)
	case "expense":
		return s.FormDecision(ctx, a, in.BusinessDecision, "expense", in.Action)
	default:
		return model.BusinessResult{}, model.Invalid("kind", "单据类型无效。")
	}
}
