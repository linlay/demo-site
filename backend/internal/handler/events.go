package handler

import (
	"demo-site/backend/internal/model"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	cursor := r.Header.Get("Last-Event-ID")
	if cursor == "" {
		cursor = r.URL.Query().Get("after")
	}
	if len(cursor) > 256 {
		s.fail(w, r, model.Invalid("after", "事件游标无效。"))
		return
	}
	batch, err := s.Sessions.Events(r.Context(), token(r), cursor)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	controller := http.NewResponseController(w)
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	write := func(kind, id string, value any) bool {
		data, e := json.Marshal(value)
		if e != nil {
			return false
		}
		// Each write is bounded without imposing the server's 60s request deadline
		// on a healthy long-lived stream. Slow/disconnected clients cannot block forever.
		_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if id != "" {
			if _, e = fmt.Fprintf(w, "id: %s\n", id); e != nil {
				return false
			}
		}
		if _, e = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", kind, data); e != nil {
			return false
		}
		return controller.Flush() == nil
	}
	if !write("ready", "", map[string]string{"workspaceId": batch.Session.ID}) {
		return
	}
	ticker := time.NewTicker(750 * time.Millisecond)
	defer ticker.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		if batch.Resync {
			view := batch.Session
			event := model.WorkspaceEvent{ID: view.EventCursor, WorkspaceID: view.ID, Generation: view.Generation, Revision: view.Revision, Type: "sync.required", Source: "server", Resources: []string{"session", "reports", "directory", "workspace"}}
			if !write("change", event.ID, event) {
				return
			}
			cursor = event.ID
		} else {
			for _, event := range batch.Events {
				if !write("change", event.ID, event) {
					return
				}
				cursor = event.ID
			}
		}
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if !write("heartbeat", "", map[string]string{"workspaceId": batch.Session.ID}) {
				return
			}
		case <-ticker.C:
		}
		batch, err = s.Sessions.Events(r.Context(), token(r), cursor)
		if err != nil {
			write("session.invalid", "", map[string]string{"message": "演示会话已变化，请重新连接。"})
			return
		}
	}
}
