package service

import (
	"context"
	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
)

func (s *Sessions) Events(ctx context.Context, token, cursor string) (repository.EventBatch, error) {
	if token == "" {
		return repository.EventBatch{}, model.Failure(401, "session.expired", "请先建立演示会话。")
	}
	return s.Store.Events(ctx, tokenHash(token), cursor, s.clock())
}
