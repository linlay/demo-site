package service_test

import (
	"context"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"fmt"
	"reflect"
	"testing"
	"time"
)

func TestTypedApprovalsAndMixedCenter(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	templates, err := s.ApprovalTemplates(ctx, a, model.GenerationInput{ExpectedGeneration: g})
	if err != nil || len(templates) != 7 {
		t.Fatalf("templates: %+v %v", templates, err)
	}
	initial, err := s.ApprovalCenter(ctx, a, model.ApprovalCenterQuery{BusinessQuery: model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-002"}, View: "pending"})
	if err != nil || initial.Total != 4 {
		t.Fatalf("mixed pending: %+v %v", initial, err)
	}
	kinds := map[string]bool{}
	for _, actor := range []string{"EMP-002", "EMP-004"} {
		queue, e := s.ApprovalCenter(ctx, a, model.ApprovalCenterQuery{BusinessQuery: model.BusinessQuery{ExpectedGeneration: g, ActorID: actor, PageSize: 100}, View: "pending"})
		if e != nil {
			t.Fatal(e)
		}
		for _, row := range queue.Items {
			kinds[row.Kind+":"+row.TemplateID] = true
		}
	}
	for _, key := range []string{"approval:risk", "approval:investment", "approval:institution", "approval:suitability", "travel:"} {
		if !kinds[key] {
			t.Fatal("missing mixed type", key)
		}
	}
	for _, template := range templates {
		fields := map[string]string{}
		for _, field := range template.Fields {
			value := "业务内容"
			switch field.Type {
			case "select":
				value = field.Options[0]
			case "date":
				value = "2026-10-20"
			case "number":
				value = "100"
			}
			fields[field.ID] = value
		}
		in := model.ApprovalSubmit{BusinessMutation: mutation(g, "EMP-001", "create-"+template.ID, 0), TemplateID: template.ID, Fields: fields, ReviewerID: "EMP-002", Title: template.Name + "申请", Description: "请审核本次申请及相关业务材料。", MaterialIDs: []string{"APMAT-001"}}
		// Validate-only must leave no record or idempotency receipt behind.
		if _, err = s.ApprovalSubmit(repository.BusinessValidation(ctx), a, in); err != nil {
			t.Fatal(err)
		}
		created, err := s.ApprovalSubmit(ctx, a, in)
		if err != nil {
			t.Fatal(err)
		}
		again, err := s.ApprovalSubmit(ctx, a, in)
		if err != nil || !reflect.DeepEqual(created, again) {
			t.Fatal("typed retry", err)
		}
		read, err := s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-002", ID: created.ID})
		if err != nil || read.Item.TemplateID != template.ID || !reflect.DeepEqual(read.Item.Fields, fields) || len(read.Tasks) != 1 {
			t.Fatalf("typed persisted: %+v %v", read, err)
		}
		_, err = s.ApprovalDecision(ctx, a, model.BusinessDecision{BusinessMutation: mutation(g, "EMP-001", "wrong-"+template.ID, 1), ID: created.ID, Opinion: "同意"}, "approve")
		status(t, err, 403)
		returned, err := s.ApprovalDecision(ctx, a, model.BusinessDecision{BusinessMutation: mutation(g, "EMP-002", "return-"+template.ID, 1), ID: created.ID, Opinion: "请补充说明"}, "return")
		if err != nil {
			t.Fatal(err)
		}
		in.ReviewerID = "EMP-002"
		in.RequestID = &created.ID
		in.BusinessMutation = mutation(g, "EMP-001", "resubmit-"+template.ID, returned.BusinessVersion)
		resubmitted, err := s.ApprovalSubmit(ctx, a, in)
		if err != nil {
			t.Fatal(err)
		}
		approved, err := s.ApprovalDecision(ctx, a, model.BusinessDecision{BusinessMutation: mutation(g, "EMP-002", "approve-"+template.ID, resubmitted.BusinessVersion), ID: created.ID, Opinion: "同意"}, "approve")
		if err != nil || approved.Status != "approved" {
			t.Fatalf("reviewer cannot approve %s: %+v %v", template.ID, approved, err)
		}
		reviewed, err := s.ApprovalCenter(ctx, a, model.ApprovalCenterQuery{BusinessQuery: model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-002"}, View: "reviewed", TemplateID: template.ID})
		found := false
		for _, row := range reviewed.Items {
			found = found || row.ID == created.ID
		}
		if err != nil || !found {
			t.Fatal("returned/resubmitted missing from reviewed", err)
		}
		if _, err = s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-002", ID: created.ID}); err != nil {
			t.Fatal("former reviewer cannot read history", err)
		}
	}
	// A submitted expense joins approvals and travel in the same queue.
	expense, err := s.ExpenseCheck(ctx, a, model.ExpenseCheck{BusinessMutation: mutation(g, "EMP-001", "center-expense-check", 0), TravelFormID: "FORM-001", DeclaredTotalCents: 5000, Receipts: []model.Receipt{{InvoiceNo: "CENTER-INV", AssetID: "AST-002", AmountCents: 5000}}, LineItems: []model.ExpenseLine{{Category: "transport", InvoiceNo: "CENTER-INV", AmountCents: 5000}}}, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.FormDecision(ctx, a, model.BusinessDecision{BusinessMutation: mutation(g, "EMP-001", "center-expense-submit", expense.BusinessVersion), ID: expense.ID}, "expense", "submit"); err != nil {
		t.Fatal(err)
	}
	queue, err := s.ApprovalCenter(ctx, a, model.ApprovalCenterQuery{BusinessQuery: model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-002", PageSize: 1}, View: "pending", TemplateID: "expense"})
	if err != nil || queue.Total != 1 || queue.Items[0].ID != expense.ID {
		t.Fatalf("expense queue: %+v %v", queue, err)
	}
}
func TestTypedApprovalValidation(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	valid := map[string]string{"riskObject": "华辰科技", "riskLevel": "高", "discoveredOn": "2026-10-15", "disposition": "降低敞口并每日复核"}
	for n, test := range []struct {
		template, reviewer string
		fields             map[string]string
	}{
		{"unknown", "EMP-002", valid}, {"risk", "EMP-001", valid}, {"risk", "EMP-003", valid}, {"risk", "EMP-002", map[string]string{}},
		{"risk", "EMP-002", map[string]string{"riskObject": "华辰科技", "riskLevel": "不存在", "discoveredOn": "2026-10-15", "disposition": "降低敞口"}},
		{"risk", "EMP-002", map[string]string{"riskObject": "华辰科技", "riskLevel": "高", "discoveredOn": "invalid", "disposition": "降低敞口"}},
	} {
		_, err := s.ApprovalSubmit(ctx, a, model.ApprovalSubmit{BusinessMutation: mutation(g, "EMP-001", fmt.Sprintf("invalid-%d", n), 0), TemplateID: test.template, Fields: test.fields, ReviewerID: test.reviewer, Title: "风险处置", Description: "请审核处置方案", MaterialIDs: []string{"APMAT-001"}})
		status(t, err, 400)
	}
	_, err := s.ApprovalCenter(ctx, a, model.ApprovalCenterQuery{BusinessQuery: model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-007"}, View: "pending"})
	status(t, err, 400)
	filtered, err := s.ApprovalCenter(ctx, a, model.ApprovalCenterQuery{BusinessQuery: model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-002"}, View: "initiated"})
	if err != nil || filtered.Total != 0 {
		t.Fatal("unrelated actor data leaked")
	}
}

func TestPersonalWorkQueuesAndCorrectionLifecycle(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	for n := 1; n <= 5; n++ {
		actor := fmt.Sprintf("EMP-%03d", n)
		queue, err := s.Tasks(ctx, a, model.BusinessQuery{ExpectedGeneration: g, ActorID: actor, PageSize: 100}, false)
		if err != nil || queue.Total < 1 {
			t.Fatalf("%s has no pending work: %+v %v", actor, queue, err)
		}
		for _, task := range queue.Items {
			if task.AssigneeID != actor {
				t.Fatalf("%s received another person's task: %+v", actor, task)
			}
		}
		summary, err := s.Workbench(ctx, a, model.BusinessQuery{ExpectedGeneration: g, ActorID: actor, PageSize: 100})
		if err != nil || summary.Pending != queue.Total {
			t.Fatal("personal summary differs", err)
		}
		done, err := s.Tasks(ctx, a, model.BusinessQuery{ExpectedGeneration: g, ActorID: actor, PageSize: 100}, true)
		if err != nil {
			t.Fatal(err)
		}
		personal := map[string]bool{}
		for _, task := range append(queue.Items, done.Items...) {
			personal[task.ID] = true
		}
		due, err := time.Parse(time.RFC3339, queue.Items[0].DueAt)
		if err != nil {
			t.Fatal(err)
		}
		daily, err := s.TodoSummarize(ctx, a, model.TodoSummaryInput{ExpectedGeneration: g, ActorID: actor, Date: due.In(time.FixedZone("Asia/Shanghai", 8*3600)).Format("2006-01-02")})
		if err != nil || len(daily.Items) == 0 {
			t.Fatal("personal daily summary is empty", err)
		}
		for _, item := range daily.Items {
			if !personal[item.TodoID] {
				t.Fatalf("%s daily summary contains another person's task: %+v", actor, item)
			}
		}
	}
	result, err := s.ApprovalSubmit(ctx, a, model.ApprovalSubmit{BusinessMutation: mutation(g, "EMP-001", "correct-personal", 2), RequestID: pointerForTest("APPR-910001"), Title: "先进制造行业调研资料补充", Description: "已补充访谈纪要和数据来源。", MaterialIDs: []string{"APMAT-001"}})
	if err != nil {
		t.Fatal(err)
	}
	author, err := s.Tasks(ctx, a, model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-001"}, false)
	if err != nil || author.Total != 19 {
		t.Fatal("correction did not leave author queue", err)
	}
	reviewer, err := s.Tasks(ctx, a, model.BusinessQuery{ExpectedGeneration: g, ActorID: "EMP-002"}, false)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, task := range reviewer.Items {
		if task.SourceID == result.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("resubmitted request not assigned to reviewer")
	}
}
func pointerForTest(s string) *string { return &s }
