package handler

import (
	"demo-site/backend/internal/model"
	"net/http"
)

func (s *Server) awcpSettings(w http.ResponseWriter, r *http.Request) {
	value, err := s.Sessions.AWCPSettings(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond(w, http.StatusOK, value)
}

func (s *Server) updateAWCPSettings(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ActiveEnabled   *bool `json:"activeEnabled"`
		ExpectedVersion int64 `json:"expectedVersion"`
	}
	if err := decode(w, r, &input); err != nil {
		s.fail(w, r, err)
		return
	}
	if input.ActiveEnabled == nil {
		s.fail(w, r, model.Invalid("activeEnabled", "缺少开关状态。"))
		return
	}
	value, err := s.Sessions.UpdateAWCPSettings(r.Context(), token(r), r.Header.Get("X-Demo-Generation"), *input.ActiveEnabled, input.ExpectedVersion)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond(w, http.StatusOK, value)
}
