package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
	"demo-site/backend/internal/service"
)

func setup(t *testing.T) (*service.Sessions, *repository.Store) {
	t.Helper()
	store, err := repository.Open(context.Background(), filepath.Join(t.TempDir(), "demo.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.DB.Close() })
	return &service.Sessions{Store: store, Profile: "acceptance"}, store
}
func status(t *testing.T, err error, want int) {
	t.Helper()
	var failure *model.Error
	if !errors.As(err, &failure) || failure.Status != want {
		t.Fatalf("want status %d, got %v", want, err)
	}
}
func TestIsolationResetReplayAndGenerationFence(t *testing.T) {
	s, store := setup(t)
	ctx := context.Background()
	a, tokenA, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	b, tokenB, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if a.ID == b.ID || a.Generation == b.Generation || len(tokenA) != 64 {
		t.Fatal("sessions must be independently random")
	}
	if a.RecordCount != 48 || len(a.Employees) != 6 {
		t.Fatal("acceptance profile is not seeded")
	}
	before, err := s.Report(ctx, tokenA, a.Generation, defaultFilter(model.ReportFilter{}))
	if err != nil {
		t.Fatal(err)
	}
	if before.Summary.Count != 48 || len(before.Items) != 20 {
		t.Fatal("report must aggregate before pagination")
	}
	// Data and jobs in one session cannot survive its reset, or leak into another.
	_, err = store.DB.ExecContext(ctx, `UPDATE report_entries SET amount_cents=1 WHERE session_id=?`, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.DB.ExecContext(ctx, `INSERT INTO demo_jobs VALUES(?,?,?,?,?,?)`, a.ID, "job-1", a.Generation, "report", "running", "{}")
	if err != nil {
		t.Fatal(err)
	}
	reset, err := s.Reset(ctx, tokenA, a.Generation, "reset-1")
	if err != nil {
		t.Fatal(err)
	}
	if reset.ID != a.ID || reset.Generation == a.Generation {
		t.Fatal("reset must preserve session and replace generation")
	}
	replay, err := s.Reset(ctx, tokenA, a.Generation, "reset-1")
	if err != nil || replay.Generation != reset.Generation {
		t.Fatalf("lost response replay: %v", err)
	}
	_, err = s.Reset(ctx, tokenA, a.Generation, "reset-2")
	status(t, err, 409)
	_, err = s.Report(ctx, tokenA, a.Generation, defaultFilter(model.ReportFilter{}))
	status(t, err, 409)
	after, err := s.Report(ctx, tokenA, reset.Generation, defaultFilter(model.ReportFilter{}))
	if err != nil {
		t.Fatal(err)
	}
	before.Generation = after.Generation
	if after.Revision <= before.Revision {
		t.Fatal("reset did not advance the event revision")
	}
	before.Revision = after.Revision
	left, _ := json.Marshal(before)
	right, _ := json.Marshal(after)
	if string(left) != string(right) {
		t.Fatal("reset did not reproduce the same seeded report")
	}
	var jobs int
	if err = store.DB.QueryRowContext(ctx, `SELECT count(*) FROM demo_jobs WHERE session_id=?`, a.ID).Scan(&jobs); err != nil || jobs != 0 {
		t.Fatalf("old jobs survived: %v", err)
	}
	other, _, err := s.Bootstrap(ctx, tokenB)
	if err != nil || other.Generation != b.Generation {
		t.Fatalf("other session affected: %v", err)
	}
}
func TestConcurrentResetOnlyOneWins(t *testing.T) {
	s, _ := setup(t)
	ctx := context.Background()
	view, token, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"one", "two"} {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.Reset(ctx, token, view.Generation, key); results <- err }()
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else {
			status(t, err, 409)
		}
	}
	if success != 1 {
		t.Fatalf("%d resets committed from one generation", success)
	}
}
func TestPersistenceExpiryAndCleanup(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "demo.sqlite")
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	store, err := repository.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	s := &service.Sessions{Store: store, Profile: "acceptance", Now: func() time.Time { return now }}
	view, token, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	store.DB.Close()
	store, err = repository.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	s.Store = store
	resumed, newToken, err := s.Bootstrap(ctx, token)
	if err != nil || newToken != "" || resumed.Generation != view.Generation {
		t.Fatalf("restart lost session: %v", err)
	}
	now = now.Add(8 * 24 * time.Hour)
	_, err = s.Report(ctx, token, view.Generation, defaultFilter(model.ReportFilter{}))
	status(t, err, 401)
	if err = store.Cleanup(ctx, now); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"demo_sessions", "employees", "departments", "report_entries", "demo_jobs", "reset_receipts"} {
		var count int
		if err = store.DB.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s cleanup: count=%d err=%v", table, count, err)
		}
	}
	replacement, _, err := s.Bootstrap(ctx, token)
	if err != nil || replacement.ID == view.ID {
		t.Fatalf("expired token not replaced: %v", err)
	}
}
func TestResetFailureRollsBackEverything(t *testing.T) {
	s, store := setup(t)
	ctx := context.Background()
	view, token, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	// Simulate seed/storage failure after deletion has begun.
	_, err = store.DB.ExecContext(ctx, `CREATE TRIGGER fail_seed BEFORE INSERT ON employees BEGIN SELECT RAISE(ABORT,'injected'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Reset(ctx, token, view.Generation, "failed"); err == nil {
		t.Fatal("injected error not propagated")
	}
	current, _, err := s.Bootstrap(ctx, token)
	if err != nil || current.Generation != view.Generation || current.RecordCount != 48 {
		t.Fatalf("failed reset partially committed: %v", err)
	}
}
func TestReportFilteringAndValidation(t *testing.T) {
	s, _ := setup(t)
	ctx := context.Background()
	view, token, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	all, err := s.Report(ctx, token, view.Generation, defaultFilter(model.ReportFilter{}))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range []model.ReportFilter{{From: "2026-02-30"}, {From: "2026-09-30", To: "2026-01-01"}, {DepartmentID: "' OR 1=1"}, {Page: -1}, {PageSize: 101}, {GroupBy: "id;DROP TABLE employees"}, {Status: "made-up"}} {
		_, err = s.Report(ctx, token, view.Generation, defaultFilter(f))
		status(t, err, 400)
	}
	row := all.Items[0]
	filtered, err := s.Report(ctx, token, view.Generation, defaultFilter(model.ReportFilter{DepartmentID: row.DepartmentID, ScenarioID: row.ScenarioID, Status: row.Status, GroupBy: "department", PageSize: 100}))
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Summary.Count == 0 || len(filtered.Groups) != 1 {
		t.Fatal("matching filter returned no data")
	}
	for _, item := range filtered.Items {
		if item.DepartmentID != row.DepartmentID || item.ScenarioID != row.ScenarioID || item.Status != row.Status {
			t.Fatal("filter leaked unrelated data")
		}
	}
	empty, err := s.Report(ctx, token, view.Generation, defaultFilter(model.ReportFilter{From: "2099-01-01"}))
	if err != nil || empty.Summary.Count != 0 || empty.Summary.AverageHours != nil {
		t.Fatalf("empty aggregate invalid: %v", err)
	}
}

// HTTP supplies these documented defaults when optional query fields are omitted.
func defaultFilter(f model.ReportFilter) model.ReportFilter {
	if f.GroupBy == "" {
		f.GroupBy = "month"
	}
	if f.Page == 0 {
		f.Page = 1
	}
	if f.PageSize == 0 {
		f.PageSize = 20
	}
	return f
}
