package service

import (
	"context"
	"demo-site/backend/internal/model"
)

func (s *Sessions) AWCPSettings(ctx context.Context) (model.AWCPSettings, error) {
	return s.Store.AWCPSettings(ctx)
}

func (s *Sessions) UpdateAWCPSettings(ctx context.Context, token, generation string, enabled bool, version int64) (model.AWCPSettings, error) {
	if token == "" {
		return model.AWCPSettings{}, model.Failure(401, "session.expired", "请先建立演示会话。")
	}
	if generation == "" {
		return model.AWCPSettings{}, model.Invalid("generation", "缺少数据版本。")
	}
	if version < 1 {
		return model.AWCPSettings{}, model.Invalid("expectedVersion", "缺少有效的设置版本。")
	}
	return s.Store.UpdateAWCPSettings(ctx, tokenHash(token), generation, enabled, version, s.clock())
}
