package service_test

import (
	"context"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"demo-site/backend/internal/service"
	"reflect"
	"sync"
	"testing"
	"time"
)

func businessSetup(t *testing.T) (*service.Sessions, model.Access, string) {
	t.Helper()
	s, _ := setup(t)
	view, cookie, err := s.Bootstrap(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	p := principal("business")
	p.Scopes = append(p.Scopes, "business:read", "business:write")
	if _, _, err = s.ConnectMCP(context.Background(), cookie, p); err != nil {
		t.Fatal(err)
	}
	return s, model.Access{Principal: &p}, view.Generation
}
func mutation(g, actor, key string, version int) model.BusinessMutation {
	return model.BusinessMutation{ExpectedGeneration: g, ActorID: actor, ExpectedVersion: version, IdempotencyKey: key}
}
func TestApprovalBusinessLifecycleAndLiveAnalysis(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	q := model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-002"}
	before, err := s.Tasks(ctx, a, q, false)
	if err != nil || before.Total != 2 {
		t.Fatalf("tasks: %+v %v", before, err)
	}
	in := model.ApprovalSubmit{BusinessMutation: mutation(g, "EMP-001", "submit", 0), Title: "测试申请", Description: "虚构用途说明", MaterialIDs: []string{"APMAT-001"}}
	created, err := s.ApprovalSubmit(ctx, a, in)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := s.ApprovalSubmit(ctx, a, in)
	if err != nil || !reflect.DeepEqual(created, replay) {
		t.Fatal("submit replay changed")
	}
	in.Title = "其他申请"
	_, err = s.ApprovalSubmit(ctx, a, in)
	status(t, err, 409)
	review := model.BusinessDecision{BusinessMutation: mutation(g, "EMP-001", "review-denied", 1), ID: created.ID, Opinion: "同意"}
	_, err = s.ApprovalDecision(ctx, a, review, "approve")
	status(t, err, 403)
	review.BusinessMutation = mutation(g, "EMP-002", "return", 1)
	returned, err := s.ApprovalDecision(ctx, a, review, "return")
	if err != nil || returned.Status != "returned" {
		t.Fatal(err)
	}
	in.RequestID = &created.ID
	in.Title = "补正申请"
	in.BusinessMutation = mutation(g, "EMP-001", "resubmit", returned.BusinessVersion)
	resubmitted, err := s.ApprovalSubmit(ctx, a, in)
	if err != nil {
		t.Fatal(err)
	}
	review.BusinessMutation = mutation(g, "EMP-002", "stale", 1)
	_, err = s.ApprovalDecision(ctx, a, review, "approve")
	status(t, err, 409)
	review.BusinessMutation = mutation(g, "EMP-002", "approve", resubmitted.BusinessVersion)
	approved, err := s.ApprovalDecision(ctx, a, review, "approve")
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.ApprovalDecision(ctx, a, review, "approve")
	if err != nil || !reflect.DeepEqual(again, approved) {
		t.Fatal("approval replay")
	}
	done, err := s.Tasks(ctx, a, q, true)
	if err != nil || done.Total != 4 {
		t.Fatalf("done: %d %v", done.Total, err)
	}
	detail, err := s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-001", ID: created.ID})
	if err != nil || len(detail.History) != 4 || len(detail.Tasks) != 2 {
		t.Fatalf("detail: %+v %v", detail, err)
	}
	report, err := s.MCPReport(ctx, *a.Principal, g, model.ReportFilter{DataSource: "business", GroupBy: "status", Page: 1, PageSize: 100})
	if err != nil || report.Summary.Count != 6 || report.Summary.Approved != 2 {
		t.Fatalf("live report: %+v %v", report.Summary, err)
	}
	denied := *a.Principal
	denied.Scopes = []string{"context:read", "business:read"}
	_, err = s.ApprovalDecision(ctx, model.Access{Principal: &denied}, review, "approve")
	status(t, err, 403)
	_, err = s.Tasks(ctx, a, model.BusinessQuery{ExpectedGeneration: "stale", ActorID: "EMP-002"}, false)
	status(t, err, 409)
	other := *a.Principal
	other.Subject = "other"
	_, err = s.Tasks(ctx, model.Access{Principal: &other}, q, false)
	status(t, err, 403)
}
func TestTravelExpenseValidationCorrectionAndReset(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	trip := model.TravelSubmit{BusinessMutation: mutation(g, "EMP-001", "travel", 0), DepartmentID: "DEP-001", TravelerIDs: []string{"EMP-001"}, Origin: "上海", Destination: "北京", StartAt: "2090-01-01T09:00:00+08:00", EndAt: "2090-01-02T09:00:00+08:00", EstimatedAmountCents: 12000}
	v, err := s.TravelSubmit(ctx, a, trip)
	if err != nil {
		t.Fatal(err)
	}
	asset, err := s.TravelAssetRegister(ctx, a, model.AssetRegister{BusinessMutation: mutation(g, "EMP-001", "asset", v.BusinessVersion), TravelFormID: v.ID, Filename: "虚构交通票据.txt"})
	if err != nil {
		t.Fatal(err)
	}
	in := model.ExpenseCheck{BusinessMutation: mutation(g, "EMP-001", "check", 0), TravelFormID: v.ID, DeclaredTotalCents: 5000, Receipts: []model.Receipt{{InvoiceNo: "INV-001", AssetID: asset.ID, AmountCents: 5000}}, LineItems: []model.ExpenseLine{{Category: "transport", InvoiceNo: "INV-001", AmountCents: 4999}}}
	_, err = s.ExpenseCheck(ctx, a, in, false)
	status(t, err, 400)
	in.LineItems[0].AmountCents = 5000
	expense, err := s.ExpenseCheck(ctx, a, in, false)
	if err != nil {
		t.Fatal(err)
	}
	in.IdempotencyKey = "duplicate"
	_, err = s.ExpenseCheck(ctx, a, in, false)
	status(t, err, 400)
	d := model.BusinessDecision{BusinessMutation: mutation(g, "EMP-001", "expense-submit", expense.BusinessVersion), ID: expense.ID}
	submitted, err := s.FormDecision(ctx, a, d, "expense", "submit")
	if err != nil {
		t.Fatal(err)
	}
	d.BusinessMutation = mutation(g, "EMP-002", "expense-return", submitted.BusinessVersion)
	d.Opinion = "请补正"
	returned, err := s.FormDecision(ctx, a, d, "expense", "return")
	if err != nil {
		t.Fatal(err)
	}
	d.BusinessMutation = mutation(g, "EMP-001", "uncorrected", returned.BusinessVersion)
	_, err = s.FormDecision(ctx, a, d, "expense", "submit")
	status(t, err, 400)
	in.ExpenseFormID = expense.ID
	in.BusinessMutation = mutation(g, "EMP-001", "correct", returned.BusinessVersion)
	corrected, err := s.ExpenseCheck(ctx, a, in, true)
	if err != nil {
		t.Fatal(err)
	}
	d.BusinessMutation = mutation(g, "EMP-001", "resubmit-expense", corrected.BusinessVersion)
	submitted, err = s.FormDecision(ctx, a, d, "expense", "submit")
	if err != nil {
		t.Fatal(err)
	}
	d.BusinessMutation = mutation(g, "EMP-002", "expense-approve", submitted.BusinessVersion)
	d.Opinion = "同意"
	approved, err := s.FormDecision(ctx, a, d, "expense", "approve")
	if err != nil || approved.Status != "approved" {
		t.Fatal(err)
	}
	reportByKind, reportErr := s.MCPReport(ctx, *a.Principal, g, model.ReportFilter{DataSource: "business", Kind: "expense", GroupBy: "status", Page: 1, PageSize: 100})
	if reportErr != nil || reportByKind.Summary.Count != 1 || reportByKind.Summary.AmountCents != 5000 || reportByKind.Items[0].Kind != "expense" {
		t.Fatalf("expense-only analysis: %+v %v", reportByKind, reportErr)
	}
	preview, err := s.MCPResetPreview(ctx, *a.Principal, g)
	if err != nil {
		t.Fatal(err)
	}
	reset, err := s.MCPReset(ctx, *a.Principal, g, "reset-business", preview.ConfirmationToken)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.ExpenseRead(ctx, a, model.BusinessRead{ExpectedGeneration: reset.Generation, ActorID: "EMP-001", ID: expense.ID})
	status(t, err, 404)
	report, err := s.MCPReport(ctx, *a.Principal, reset.Generation, model.ReportFilter{DataSource: "business", GroupBy: "status", Page: 1, PageSize: 100})
	if err != nil || report.Summary.Count != 5 {
		t.Fatalf("reset: %+v %v", report, err)
	}
}
func TestBusinessTransactionRollsBackOnEventFailure(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	if _, err := s.Store.DB.Exec(`CREATE TRIGGER fail_business_event BEFORE INSERT ON workspace_events BEGIN SELECT RAISE(ABORT,'injected'); END`); err != nil {
		t.Fatal(err)
	}
	in := model.BusinessDecision{BusinessMutation: mutation(g, "EMP-002", "approve-rollback", 1), ID: "APPR-001", Opinion: "同意"}
	if _, err := s.ApprovalDecision(ctx, a, in, "approve"); err == nil {
		t.Fatal("failed event was ignored")
	}
	if _, err := s.Store.DB.Exec(`DROP TRIGGER fail_business_event`); err != nil {
		t.Fatal(err)
	}
	detail, err := s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-002", ID: "APPR-001"})
	if err != nil || detail.Item.Status != "submitted" || detail.Tasks[0].Status != "open" {
		t.Fatal("partial business commit")
	}
	if _, err = s.ApprovalDecision(ctx, a, in, "approve"); err != nil {
		t.Fatal("receipt consumed on rollback", err)
	}
}

func TestBusinessValidationIsReadOnlyAndDraftContract(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	// Initialize once so we compare business state, not fixture provisioning.
	if _, err := s.TravelRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-001", ID: "FORM-002"}); err != nil {
		t.Fatal(err)
	}
	in := model.ApprovalSubmit{BusinessMutation: mutation(g, "EMP-001", "validation-key", 0), Title: "校验申请", Description: "只读动态校验", MaterialIDs: []string{"APMAT-001"}}
	if _, err := s.ApprovalSubmit(repository.BusinessValidation(ctx), a, in); err != nil {
		t.Fatal(err)
	}
	var requests, receipts, events int
	if err := s.Store.DB.QueryRow(`SELECT (SELECT count(*) FROM approval_requests),(SELECT count(*) FROM business_receipts),(SELECT count(*) FROM workspace_events)`).Scan(&requests, &receipts, &events); err != nil {
		t.Fatal(err)
	}
	if requests != 3 || receipts != 0 || events != 0 {
		t.Fatalf("validation mutated state: %d %d %d", requests, receipts, events)
	}
	draft, err := s.TravelDraftSave(ctx, a, model.TravelDraft{BusinessMutation: mutation(g, "EMP-001", "save-draft", 1), FormID: "FORM-002", ApplicantID: "EMP-001", DepartmentID: "DEP-001", AmountCents: 5000, AssetIDs: []string{"AST-004"}})
	if err != nil || draft.BusinessVersion != 2 {
		t.Fatal(err)
	}
	read, err := s.TravelRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-001", ID: "FORM-002"})
	if err != nil || len(read.Assets) != 1 || read.Assets[0].OwnerID != "FORM-002" {
		t.Fatalf("draft: %+v %v", read, err)
	}
	if _, err = s.ApprovalSubmit(ctx, a, in); err != nil {
		t.Fatal("validation consumed intent", err)
	}
}

func TestConcurrentReviewAndPersistenceAcrossRestart(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	outcomes := make(chan error, 2)
	for _, key := range []string{"concurrent-a", "concurrent-b"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			_, err := s.ApprovalDecision(ctx, a, model.BusinessDecision{BusinessMutation: mutation(g, "EMP-002", key, 1), ID: "APPR-001", Opinion: "同意"}, "approve")
			outcomes <- err
		}(key)
	}
	wg.Wait()
	close(outcomes)
	success, conflicts := 0, 0
	for err := range outcomes {
		if err == nil {
			success++
		} else {
			status(t, err, 409)
			conflicts++
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("concurrent review: %d %d", success, conflicts)
	}
	var sequence int
	var name, path string
	if err := s.Store.DB.QueryRow(`PRAGMA database_list`).Scan(&sequence, &name, &path); err != nil {
		t.Fatal(err)
	}
	if err := s.Store.DB.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := repository.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	s.Store = reopened
	read, err := s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-001", ID: "APPR-001"})
	if err != nil || read.Item.Status != "approved" || len(read.Decisions) != 1 || read.Tasks[0].Status != "done" {
		t.Fatalf("lost business state after restart: %+v %v", read, err)
	}
}

func TestPrimitiveRecordSnapshotsAndTaskFilters(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	approvals, err := s.Records(ctx, a, model.RecordQuery{BusinessQuery: model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-001", PageSize: 1}, Kind: "approval"})
	if err != nil || approvals.Total != 3 || len(approvals.Items) != 1 || len(approvals.Materials) != 2 {
		t.Fatalf("approval options: %+v %v", approvals, err)
	}
	travel, err := s.Records(ctx, a, model.RecordQuery{BusinessQuery: model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-001"}, Kind: "travel", ID: "FORM-001"})
	if err != nil || len(travel.Items) != 1 || len(travel.Items[0].Assets) != 3 || len(travel.Items[0].Tasks) != 1 {
		t.Fatalf("travel detail: %+v %v", travel, err)
	}
	_, err = s.Records(ctx, a, model.RecordQuery{BusinessQuery: model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-003"}, Kind: "travel", ID: "FORM-001"})
	status(t, err, 403)
	readOnly := *a.Principal
	readOnly.Scopes = []string{"context:read", "business:read"}
	if _, err = s.QueryTasks(ctx, model.Access{Principal: &readOnly}, model.TaskQuery{ExpectedGeneration: g, ActorID: "EMP-002", Status: "done"}); err != nil {
		t.Fatal(err)
	}
	_, err = s.Transition(ctx, model.Access{Principal: &readOnly}, model.WorkflowTransition{BusinessDecision: model.BusinessDecision{BusinessMutation: mutation(g, "EMP-002", "readonly-transition", 1), ID: "APPR-001", Opinion: "同意"}, Kind: "approval", Action: "approve"})
	status(t, err, 403)
	empty, err := s.QueryTasks(ctx, a, model.TaskQuery{ExpectedGeneration: g, ActorID: "EMP-002", Status: "open", From: "2090-01-01", To: "2090-01-01"})
	if err != nil || empty.Total != 0 {
		t.Fatal("task date filter", err)
	}
	done, err := s.QueryTasks(ctx, a, model.TaskQuery{ExpectedGeneration: g, ActorID: "EMP-002", Status: "done", Kind: "approval", PageSize: 1})
	if err != nil || done.Total != 2 || len(done.Items) != 1 {
		t.Fatal("task pagination", err)
	}
	day := time.Date(2090, 1, 1, 16, 0, 0, 0, time.UTC)
	if _, err = s.Store.DB.Exec(`UPDATE demo_sessions SET expires_at=?`, day.Add(time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	s.Now = func() time.Time { return day }
	approved, err := s.Transition(ctx, a, model.WorkflowTransition{BusinessDecision: model.BusinessDecision{BusinessMutation: mutation(g, "EMP-002", "timezone-transition", 1), ID: "APPR-001", Opinion: "同意"}, Kind: "approval", Action: "approve"})
	if err != nil || approved.Status != "approved" {
		t.Fatal(err)
	}
	dayTasks, err := s.QueryTasks(ctx, a, model.TaskQuery{ExpectedGeneration: g, ActorID: "EMP-002", Status: "done", Kind: "approval", From: "2090-01-02", To: "2090-01-02"})
	if err != nil || dayTasks.Total != 1 || dayTasks.Items[0].SourceID != "APPR-001" {
		t.Fatalf("Shanghai completion date: %+v %v", dayTasks, err)
	}
	previousDay, err := s.QueryTasks(ctx, a, model.TaskQuery{ExpectedGeneration: g, ActorID: "EMP-002", Status: "done", From: "2090-01-01", To: "2090-01-01"})
	if err != nil || previousDay.Total != 0 {
		t.Fatal("UTC date used for task filtering", err)
	}
}
