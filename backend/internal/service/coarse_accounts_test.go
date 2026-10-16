package service_test

import (
	"context"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"fmt"
	"testing"
)

func TestCoarseRolesHaveDistinctActionablePersonalQueues(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	seen := map[string]bool{}
	for actor, want := range map[string]int{"EMP-001": 20, "EMP-003": 12, "EMP-005": 3} {
		queue, err := s.Tasks(ctx, a, model.BusinessQuery{ExpectedGeneration: g, ActorID: actor, PageSize: 100}, false)
		if err != nil || queue.Total != want {
			t.Fatalf("%s queue: %d want %d: %v", actor, queue.Total, want, err)
		}
		center, err := s.ApprovalCenter(ctx, a, model.ApprovalCenterQuery{BusinessQuery: model.BusinessQuery{ExpectedGeneration: g, ActorID: actor, PageSize: 100}, View: "handling"})
		if err != nil || center.Total != want {
			t.Fatalf("%s handling list: %d want %d: %v", actor, center.Total, want, err)
		}
		for _, task := range queue.Items {
			if seen[task.ID] || task.AssigneeID != actor {
				t.Fatal("personal queues overlap", task)
			}
			seen[task.ID] = true
			detail, err := s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: actor, ID: task.SourceID})
			if err != nil || detail.Item.ApplicantID != actor || detail.Item.Status != "returned" {
				t.Fatalf("task is not actionable: %+v %v", detail, err)
			}
			if task.SourceID >= "APPR-920001" {
				_, err = s.ApprovalSubmit(repository.BusinessValidation(ctx), a, model.ApprovalSubmit{BusinessMutation: mutation(g, actor, "validate-"+task.SourceID, detail.Item.BusinessVersion), RequestID: &detail.Item.ID, Title: detail.Item.Title, Description: detail.Item.Description, MaterialIDs: detail.Item.MaterialIDs, TemplateID: detail.Item.TemplateID, Fields: detail.Item.Fields, ReviewerID: detail.Item.ReviewerID})
				if err != nil {
					t.Fatal("seed request cannot be resubmitted", task.SourceID, err)
				}
			}
		}
	}
	_, err := s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-003", ID: "APPR-920001"})
	status(t, err, 403)
	for _, actor := range []string{"EMP-002", "EMP-004"} {
		queue, err := s.Tasks(ctx, a, model.BusinessQuery{ExpectedGeneration: g, ActorID: actor, PageSize: 100}, false)
		if err != nil || queue.Total == 0 {
			t.Fatal("reviewer has no assigned work", actor, err)
		}
	}
	read, err := s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-006", ID: "APPR-920001"})
	if err != nil || read.Item.ID == "" {
		t.Fatal("analyst cannot drill into a record", err)
	}
	_, err = s.ApprovalSubmit(ctx, a, model.ApprovalSubmit{BusinessMutation: mutation(g, "EMP-006", "analyst-start", 0), Title: "分析记录", Description: "分析账户不发起", MaterialIDs: []string{"APMAT-001"}})
	status(t, err, 400)
}

func TestEveryOperatorAndReviewerCanHandleEveryTemplate(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	templates, err := s.ApprovalTemplates(ctx, a, model.GenerationInput{ExpectedGeneration: g})
	if err != nil {
		t.Fatal(err)
	}
	for _, actor := range []string{"EMP-001", "EMP-003", "EMP-005"} {
		for _, reviewer := range []string{"EMP-002", "EMP-004"} {
			for _, template := range templates {
				fields := map[string]string{}
				for _, field := range template.Fields {
					value := "业务说明"
					switch field.Type {
					case "select":
						value = field.Options[0]
					case "number":
						value = "100"
					case "date":
						value = "2026-10-20"
					}
					fields[field.ID] = value
				}
				key := fmt.Sprintf("%s-%s-%s", actor, reviewer, template.ID)
				created, err := s.ApprovalSubmit(ctx, a, model.ApprovalSubmit{BusinessMutation: mutation(g, actor, "start-"+key, 0), TemplateID: template.ID, Fields: fields, ReviewerID: reviewer, Title: template.Name, Description: "请审核业务资料。", MaterialIDs: []string{"APMAT-001"}})
				if err != nil {
					t.Fatal(key, err)
				}
				approved, err := s.ApprovalDecision(ctx, a, model.BusinessDecision{BusinessMutation: mutation(g, reviewer, "review-"+key, created.BusinessVersion), ID: created.ID, Opinion: "同意"}, "approve")
				if err != nil || approved.Status != "approved" {
					t.Fatal(key, approved, err)
				}
			}
		}
	}
}
