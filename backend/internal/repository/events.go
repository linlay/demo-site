package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"demo-site/backend/internal/model"
)

func eventCursor(workspace string, revision int64) string {
	return workspace + ":" + strconv.FormatInt(revision, 10)
}

// AppendEvent must run inside the same transaction as the domain write. A retry
// returning a stored receipt must not call this again. Resources describe query
// dependencies, not frontend routes or instructions to reload a document.
func AppendEvent(ctx context.Context, tx *sql.Tx, view *model.Session, kind, source, operationID string, resources []string, now time.Time) error {
	data, err := json.Marshal(resources)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO workspace_events(session_id,generation,kind,source,operation_id,resources,created_at) VALUES(?,?,?,?,?,?,?)`, view.ID, view.Generation, kind, source, operationID, string(data), now.Unix())
	if err != nil {
		return err
	}
	view.Revision, err = result.LastInsertId()
	if err != nil {
		return err
	}
	view.EventCursor = eventCursor(view.ID, view.Revision)
	if _, err = tx.ExecContext(ctx, `UPDATE demo_sessions SET event_revision=? WHERE id=?`, view.Revision, view.ID); err != nil {
		return err
	}
	// Keep a bounded durable replay window; revision survives pruning and reset.
	_, err = tx.ExecContext(ctx, `DELETE FROM workspace_events WHERE session_id=? AND sequence < (SELECT sequence FROM workspace_events WHERE session_id=? ORDER BY sequence DESC LIMIT 1 OFFSET 999)`, view.ID, view.ID)
	return err
}

type EventBatch struct {
	Session model.Session
	Events  []model.WorkspaceEvent
	Resync  bool
}

// Authentication, snapshot version and replay are read in one transaction.
// This does not extend browser lifetime merely because a background tab is open.
func (s *Store) Events(ctx context.Context, hash, cursor string, now time.Time) (EventBatch, error) {
	var batch EventBatch
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return batch, err
	}
	defer tx.Rollback()
	batch.Session, err = loadSession(ctx, tx, hash, now)
	if err != nil {
		return batch, err
	}
	prefix := batch.Session.ID + ":"
	after, parseErr := strconv.ParseInt(strings.TrimPrefix(cursor, prefix), 10, 64)
	batch.Resync = cursor == "" || !strings.HasPrefix(cursor, prefix) || parseErr != nil || after < 0 || after > batch.Session.Revision
	var oldest, count int64
	if err = tx.QueryRowContext(ctx, `SELECT coalesce(min(sequence),0),count(*) FROM workspace_events WHERE session_id=?`, batch.Session.ID).Scan(&oldest, &count); err != nil {
		return batch, err
	}
	if count >= 1000 && after < oldest {
		batch.Resync = true
	}
	if batch.Resync {
		return batch, tx.Commit()
	}
	rows, err := tx.QueryContext(ctx, `SELECT sequence,generation,kind,source,operation_id,resources FROM workspace_events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT 128`, batch.Session.ID, after)
	if err != nil {
		return batch, err
	}
	for rows.Next() {
		var event model.WorkspaceEvent
		var resources string
		if err = rows.Scan(&event.Revision, &event.Generation, &event.Type, &event.Source, &event.OperationID, &resources); err != nil {
			rows.Close()
			return batch, err
		}
		event.WorkspaceID = batch.Session.ID
		event.ID = eventCursor(event.WorkspaceID, event.Revision)
		if err = json.Unmarshal([]byte(resources), &event.Resources); err != nil {
			rows.Close()
			return batch, err
		}
		batch.Events = append(batch.Events, event)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return batch, err
	}
	return batch, tx.Commit()
}
