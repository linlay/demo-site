package service_test

import (
	"context"
	"testing"
	"time"

	"demo-site/backend/internal/model"
	"demo-site/backend/internal/service"
)

func principal(subject string) model.Principal {
	return model.Principal{Issuer: "https://auth.example/realms/awcp", Subject: subject, ClientID: "test-client", Scopes: []string{"context:read", "directory:read", "reports:read", "demo:reset"}}
}

func TestMCPBindingIsolationRotationAndRevocation(t *testing.T) {
	s, _ := setup(t)
	ctx := context.Background()
	p := principal("a")
	a, cookie, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.MCPContext(ctx, p)
	status(t, err, 403)
	linked, rotated, err := s.ConnectMCP(ctx, cookie, p)
	if err != nil || linked.ID != a.ID || rotated == cookie {
		t.Fatalf("connect: %v", err)
	}
	view, err := s.MCPContext(ctx, p)
	if err != nil || view.ID != a.ID {
		t.Fatalf("context: %v", err)
	}
	_, err = s.MCPContext(ctx, principal("b"))
	status(t, err, 403)
	_, _, err = s.ConnectMCP(ctx, rotated, principal("b"))
	status(t, err, 403)
	_, err = s.Report(ctx, cookie, a.Generation, defaultFilter(model.ReportFilter{}))
	status(t, err, 401)
	f := defaultFilter(model.ReportFilter{})
	r, err := s.MCPReport(ctx, p, a.Generation, f)
	if err != nil || r.Summary.Count != 48 {
		t.Fatalf("report: %v", err)
	}
	_, err = s.MCPReport(ctx, p, b.Generation, f)
	status(t, err, 409)
	low := p
	low.Scopes = []string{"context:read"}
	_, err = s.MCPReport(ctx, low, a.Generation, f)
	status(t, err, 403)
	if err = s.DisconnectMCP(ctx, rotated); err != nil {
		t.Fatal(err)
	}
	_, err = s.MCPContext(ctx, p)
	status(t, err, 403)
}

func TestMCPResetConfirmationBindsClientGenerationAndKey(t *testing.T) {
	s, store := setup(t)
	ctx := context.Background()
	p := principal("a")
	a, cookie, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = s.ConnectMCP(ctx, cookie, p)
	if err != nil {
		t.Fatal(err)
	}
	preview, err := s.MCPResetPreview(ctx, p, a.Generation)
	if err != nil {
		t.Fatal(err)
	}
	otherClient := p
	otherClient.ClientID = "other-client"
	_, err = s.MCPReset(ctx, otherClient, a.Generation, "key", preview.ConfirmationToken)
	status(t, err, 403)
	reset, err := s.MCPReset(ctx, p, a.Generation, "key", preview.ConfirmationToken)
	if err != nil || reset.Generation == a.Generation {
		t.Fatalf("reset: %v", err)
	}
	replay, err := s.MCPReset(ctx, p, a.Generation, "key", preview.ConfirmationToken)
	if err != nil || replay.Generation != reset.Generation {
		t.Fatalf("replay: %v", err)
	}
	_, err = s.MCPReset(ctx, p, a.Generation, "different-key", preview.ConfirmationToken)
	status(t, err, 409)
	var count int
	if err = store.DB.QueryRow(`SELECT count(*) FROM mcp_audit_events WHERE operation='workspace_reset_execute'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("reset audit count %d: %v", count, err)
	}
	next, err := s.MCPResetPreview(ctx, p, reset.Generation)
	if err != nil {
		t.Fatal(err)
	}
	s.Now = func() time.Time { return time.Now().Add(6 * time.Minute) }
	_, err = s.MCPReset(ctx, p, reset.Generation, "next", next.ConfirmationToken)
	status(t, err, 409)
}

func TestMCPResetRollsBackConfirmationAndAuditOnFailure(t *testing.T) {
	s, store := setup(t)
	ctx := context.Background()
	p := principal("a")
	a, cookie, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = s.ConnectMCP(ctx, cookie, p)
	if err != nil {
		t.Fatal(err)
	}
	preview, err := s.MCPResetPreview(ctx, p, a.Generation)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.DB.Exec(`CREATE TRIGGER fail_mcp_seed BEFORE INSERT ON employees BEGIN SELECT RAISE(ABORT,'injected'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.MCPReset(ctx, p, a.Generation, "key", preview.ConfirmationToken); err == nil {
		t.Fatal("injected failure ignored")
	}
	view, err := s.MCPContext(ctx, p)
	if err != nil || view.Generation != a.Generation {
		t.Fatal("failed reset was committed")
	}
	_, err = store.DB.Exec(`DROP TRIGGER fail_mcp_seed`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.MCPReset(ctx, p, a.Generation, "retry-key", preview.ConfirmationToken); err != nil {
		t.Fatalf("confirmation consumed outside rollback: %v", err)
	}
}

func TestMCPDirectoryPaginatesOnlyOwnFixtures(t *testing.T) {
	s, _ := setup(t)
	ctx := context.Background()
	p := principal("a")
	_, cookie, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = s.ConnectMCP(ctx, cookie, p)
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.MCPDirectory(ctx, p, service.DirectoryFilter{Page: 2, PageSize: 1})
	if err != nil || len(r.Employees) != 1 || r.Total != 6 {
		t.Fatalf("directory: %+v %v", r, err)
	}
	_, err = s.MCPDirectory(ctx, p, service.DirectoryFilter{PageSize: 101})
	status(t, err, 400)
}
