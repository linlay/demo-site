package service_test

import (
	"context"
	"demo-site/backend/internal/repository"
	"testing"
	"time"
)

func TestEventsMultipleBrowsersMCPResetAndReplay(t *testing.T) {
	s, _ := setup(t)
	ctx := context.Background()
	p := principal("shared")
	a, first, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	_, first, err = s.ConnectMCP(ctx, first, p)
	if err != nil {
		t.Fatal(err)
	}
	_, second, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	originalSecond := second
	b, second, err := s.ConnectMCP(ctx, second, p)
	if err != nil || a.ID != b.ID {
		t.Fatalf("shared binding: %v", err)
	}
	// A second login no longer invalidates the first browser.
	for _, cookie := range []string{first, second} {
		batch, err := s.Events(ctx, cookie, a.EventCursor)
		if err != nil || batch.Session.ID != a.ID {
			t.Fatalf("browser revoked: %v", err)
		}
	}
	_, err = s.Events(ctx, originalSecond, a.EventCursor)
	status(t, err, 401)
	preview, err := s.MCPResetPreview(ctx, p, a.Generation)
	if err != nil {
		t.Fatal(err)
	}
	next, err := s.MCPReset(ctx, p, a.Generation, "event-reset", preview.ConfirmationToken)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := s.MCPReset(ctx, p, a.Generation, "event-reset", preview.ConfirmationToken)
	if err != nil || replay.Revision != next.Revision {
		t.Fatalf("reset receipt: %v", err)
	}
	for _, cookie := range []string{first, second} {
		batch, err := s.Events(ctx, cookie, a.EventCursor)
		if err != nil || len(batch.Events) != 1 {
			t.Fatalf("event replay: %v %+v", err, batch)
		}
		event := batch.Events[0]
		if event.Source != "mcp" || event.Generation != next.Generation || event.ID != next.EventCursor || event.OperationID != next.OperationID {
			t.Fatalf("event: %+v", event)
		}
		caughtUp, err := s.Events(ctx, cookie, event.ID)
		if err != nil || len(caughtUp.Events) != 0 {
			t.Fatalf("duplicate delivery on cursor: %v", err)
		}
	}
	other, cookie, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := s.Events(ctx, cookie, next.EventCursor)
	if err != nil || !foreign.Resync || len(foreign.Events) != 0 || foreign.Session.ID != other.ID {
		t.Fatalf("cross-workspace cursor: %v", err)
	}
	// Independent browser credential expiry is checked on every replay poll.
	s.Now = func() time.Time { return time.Now().Add(repository.SessionLifetime + time.Hour) }
	_, err = s.Events(ctx, first, next.EventCursor)
	status(t, err, 401)
}

func TestEventRollbackRetentionAndRestart(t *testing.T) {
	s, store := setup(t)
	ctx := context.Background()
	view, cookie, err := s.Bootstrap(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	original := view
	tx, err := store.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = repository.AppendEvent(ctx, tx, &view, "business.changed", "browser", "rollback", []string{"reports"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	batch, err := s.Events(ctx, cookie, original.EventCursor)
	if err != nil || len(batch.Events) != 0 || batch.Session.Revision != 0 {
		t.Fatalf("uncommitted event escaped: %v", err)
	}
	tx, err = store.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 1001; i++ {
		if err = repository.AppendEvent(ctx, tx, &view, "business.changed", "browser", "fixture", []string{"reports"}, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = store.DB.QueryRow(`SELECT count(*) FROM workspace_events WHERE session_id=?`, view.ID).Scan(&count); err != nil || count != 1000 {
		t.Fatalf("retention %d: %v", count, err)
	}
	batch, err = s.Events(ctx, cookie, original.EventCursor)
	if err != nil || !batch.Resync || batch.Session.Revision != view.Revision {
		t.Fatalf("expired cursor: %v", err)
	}
	// Durable rows can be replayed through a new Store, without any in-memory hub.
	replacement := &repository.Store{DB: store.DB}
	s.Store = replacement
	batch, err = s.Events(ctx, cookie, view.ID+":999")
	if err != nil || batch.Resync || len(batch.Events) != 2 {
		t.Fatalf("durable replay: %v %+v", err, batch)
	}
}
