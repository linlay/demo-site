package service_test

import (
	"context"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"testing"
)

func TestCoarseAccountUpgradePreservesHistoryAndTransfersOpenWork(t *testing.T) {
	s, a, g := businessSetup(t)
	ctx := context.Background()
	if _, err := s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-001", ID: "APPR-001"}); err != nil {
		t.Fatal(err)
	}
	// Recreate the operational ownership of a pre-upgrade workspace.
	for _, query := range []string{
		`UPDATE employees SET active=1,roles='["employee","manager"]'`,
		`UPDATE approval_requests SET applicant_id='EMP-003',reviewer_id='EMP-004',department_id='DEP-002',business_version=10 WHERE id='APPR-001'`,
		`UPDATE approval_requests SET status='approved',applicant_id='EMP-003',reviewer_id='EMP-004',department_id='DEP-002',business_version=8 WHERE id='APPR-900001'`,
		`UPDATE business_forms SET applicant_id='EMP-003',reviewer_id='EMP-004',department_id='DEP-002',business_version=6 WHERE id='FORM-002'`,
		`UPDATE business_tasks SET assignee_id='EMP-004' WHERE status='open'`,
		`DELETE FROM business_tasks WHERE source_id LIKE 'APPR-920%'`,
		`DELETE FROM business_history WHERE source_id LIKE 'APPR-920%'`,
		`DELETE FROM approval_requests WHERE id LIKE 'APPR-920%'`,
		`DROP TABLE workflow_samples_initialized`,
		`DELETE FROM schema_migrations WHERE name='011_coarse_workflow_roles.sql'`,
	} {
		if _, err := s.Store.DB.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	var historyBefore, decisionsBefore int
	if err := s.Store.DB.QueryRow(`SELECT (SELECT count(*) FROM business_history WHERE source_id NOT LIKE 'APPR-920%'),(SELECT count(*) FROM approval_decisions WHERE request_id NOT LIKE 'APPR-920%')`).Scan(&historyBefore, &decisionsBefore); err != nil {
		t.Fatal(err)
	}
	var sequence int
	var databaseName, path string
	if err := s.Store.DB.QueryRow(`PRAGMA database_list`).Scan(&sequence, &databaseName, &path); err != nil {
		t.Fatal(err)
	}
	if err := s.Store.DB.Close(); err != nil {
		t.Fatal(err)
	}
	upgraded, err := repository.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.DB.Close()
	s.Store = upgraded
	// Loading existing business state adds the new queues without resetting the workspace.
	if _, err = s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-002", ID: "APPR-001"}); err != nil {
		t.Fatal(err)
	}
	var active, pending, corrections, historyAfter, decisionsAfter int
	if err = upgraded.DB.QueryRow(`SELECT
		(SELECT count(*) FROM employees WHERE active=1),
		(SELECT count(*) FROM business_tasks WHERE status='open' AND source_id='APPR-001' AND assignee_id='EMP-004'),
		(SELECT count(*) FROM business_tasks WHERE status='open' AND source_id='APPR-910001' AND assignee_id='EMP-001'),
		(SELECT count(*) FROM business_history WHERE source_id NOT LIKE 'APPR-920%'),(SELECT count(*) FROM approval_decisions WHERE request_id NOT LIKE 'APPR-920%')`).Scan(&active, &pending, &corrections, &historyAfter, &decisionsAfter); err != nil {
		t.Fatal(err)
	}
	if active != 6 || pending != 1 || corrections != 1 || historyBefore != historyAfter || decisionsBefore != decisionsAfter {
		t.Fatalf("upgrade lost work or history: %d %d %d %d/%d %d/%d", active, pending, corrections, historyBefore, historyAfter, decisionsBefore, decisionsAfter)
	}
	open, err := s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-002", ID: "APPR-001"})
	if err != nil || open.Item.ApplicantID != "EMP-003" || open.Item.ReviewerID != "EMP-004" || open.Item.BusinessVersion != 10 {
		t.Fatalf("open ownership/version: %+v %v", open, err)
	}
	closed, err := s.ApprovalRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-002", ID: "APPR-900001"})
	if err != nil || closed.Item.ApplicantID != "EMP-003" || closed.Item.ReviewerID != "EMP-004" || closed.Item.BusinessVersion != 8 {
		t.Fatalf("closed history cannot be read or was rewritten: %+v %v", closed, err)
	}
	draft, err := s.TravelRead(ctx, a, model.BusinessRead{ExpectedGeneration: g, ActorID: "EMP-003", ID: "FORM-002"})
	if err != nil || draft.Item.ApplicantID != "EMP-003" || draft.Item.ReviewerID != "EMP-004" || draft.Item.BusinessVersion != 6 {
		t.Fatalf("draft transfer/version: %+v %v", draft, err)
	}
}
