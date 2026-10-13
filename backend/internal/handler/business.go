package handler

import (
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"demo-site/backend/internal/service"
	"net/http"
)

func (s *Server) business(w http.ResponseWriter, r *http.Request) {
	a := service.BrowserAccess(token(r))
	ctx := r.Context()
	if r.PathValue("validation") == "validate" {
		ctx = repository.BusinessValidation(ctx)
	}
	op := r.PathValue("operation")
	if r.PathValue("validation") != "" && r.PathValue("validation") != "validate" {
		s.fail(w, r, model.Failure(404, "request.not-found", "接口不存在。"))
		return
	}
	var out any
	var err error
	switch op {
	case "travel_draft_save":
		var in model.TravelDraft
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			out, err = s.Sessions.TravelDraftSave(ctx, a, in)
		}
	case "todo_complete":
		var in model.TodoComplete
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			out, err = s.Sessions.TodoComplete(ctx, a, in)
		}
	case "todo_summarize":
		var in model.TodoSummaryInput
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			out, err = s.Sessions.TodoSummarize(ctx, a, in)
		}
	case "todos_query", "done_query", "workbench_summary", "approvals_query", "travels_query", "expenses_query":
		var in model.BusinessQuery
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			switch op {
			case "todos_query", "done_query":
				out, err = s.Sessions.Tasks(ctx, a, in, op == "done_query")
			case "workbench_summary":
				out, err = s.Sessions.Workbench(ctx, a, in)
			case "approvals_query":
				out, err = s.Sessions.Approvals(ctx, a, in)
			case "travels_query":
				out, err = s.Sessions.Travels(ctx, a, in)
			case "expenses_query":
				out, err = s.Sessions.Expenses(ctx, a, in)
			}
		}
	case "approval_read", "travel_read", "expense_read", "travel_receipts_list":
		var in model.BusinessRead
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			switch op {
			case "approval_read":
				out, err = s.Sessions.ApprovalRead(ctx, a, in)
			case "travel_read":
				out, err = s.Sessions.TravelRead(ctx, a, in)
			case "expense_read":
				out, err = s.Sessions.ExpenseRead(ctx, a, in)
			case "travel_receipts_list":
				out, err = s.Sessions.TravelAssets(ctx, a, in)
			}
		}
	case "approval_materials_list":
		var in model.GenerationInput
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			out, err = s.Sessions.ApprovalMaterials(ctx, a, in)
		}
	case "approval_submit":
		var in model.ApprovalSubmit
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			out, err = s.Sessions.ApprovalSubmit(ctx, a, in)
		}
	case "travel_submit":
		var in model.TravelSubmit
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			out, err = s.Sessions.TravelSubmit(ctx, a, in)
		}
	case "travel_receipt_register":
		var in model.AssetRegister
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			out, err = s.Sessions.TravelAssetRegister(ctx, a, in)
		}
	case "expense_check", "expense_correct":
		var in model.ExpenseCheck
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			out, err = s.Sessions.ExpenseCheck(ctx, a, in, op == "expense_correct")
		}
	case "approval_approve", "approval_return", "approval_withdraw", "travel_approve", "travel_return", "travel_resubmit", "expense_submit", "expense_approve", "expense_return":
		var in model.BusinessDecision
		if err = s.decodeBusiness(w, r, &in, &in.ExpectedGeneration); err == nil {
			switch op {
			case "approval_approve":
				out, err = s.Sessions.ApprovalDecision(ctx, a, in, "approve")
			case "approval_return":
				out, err = s.Sessions.ApprovalDecision(ctx, a, in, "return")
			case "approval_withdraw":
				out, err = s.Sessions.ApprovalDecision(ctx, a, in, "withdraw")
			case "travel_approve":
				out, err = s.Sessions.FormDecision(ctx, a, in, "travel", "approve")
			case "travel_return":
				out, err = s.Sessions.FormDecision(ctx, a, in, "travel", "return")
			case "travel_resubmit":
				out, err = s.Sessions.FormDecision(ctx, a, in, "travel", "submit")
			case "expense_submit":
				out, err = s.Sessions.FormDecision(ctx, a, in, "expense", "submit")
			case "expense_approve":
				out, err = s.Sessions.FormDecision(ctx, a, in, "expense", "approve")
			case "expense_return":
				out, err = s.Sessions.FormDecision(ctx, a, in, "expense", "return")
			}
		}
	default:
		err = model.Failure(404, "request.not-found", "业务接口不存在。")
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if r.PathValue("validation") == "validate" {
		respond(w, 200, map[string]any{"valid": true, "fieldErrors": []model.FieldError{}})
		return
	}
	s.renewCookie(w, token(r))
	respond(w, 200, out)
}
func (s *Server) decodeBusiness(w http.ResponseWriter, r *http.Request, in any, generation *string) error {
	if err := decode(w, r, in); err != nil {
		return err
	}
	header := r.Header.Get("X-Demo-Generation")
	if header == "" {
		return model.Invalid("expectedGeneration", "缺少数据版本。")
	}
	if *generation != "" && *generation != header {
		return model.Failure(409, "session.generation-conflict", "请求版本与会话版本不一致。")
	}
	*generation = header
	return nil
}
