package repository

import (
	"context"
	"time"

	"demo-site/backend/internal/model"
)

func (s *Store) AWCPSettings(ctx context.Context) (model.AWCPSettings, error) {
	var value model.AWCPSettings
	err := s.DB.QueryRowContext(ctx, `SELECT active_enabled,version FROM awcp_settings WHERE id=1`).Scan(&value.ActiveEnabled, &value.Version)
	return value, err
}

func (s *Store) UpdateAWCPSettings(ctx context.Context, hash, generation string, enabled bool, version int64, now time.Time) (model.AWCPSettings, error) {
	var value model.AWCPSettings
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return value, err
	}
	defer tx.Rollback()
	session, err := loadSession(ctx, tx, hash, now)
	if err != nil {
		return value, err
	}
	if session.Generation != generation {
		return value, model.Failure(409, "session.generation-conflict", "演示空间已变化，请先载入最新数据。")
	}
	if err = tx.QueryRowContext(ctx, `SELECT active_enabled,version FROM awcp_settings WHERE id=1`).Scan(&value.ActiveEnabled, &value.Version); err != nil {
		return value, err
	}
	if value.Version != version {
		return value, model.Failure(409, "awcp.settings-conflict", "AWCP 设置已被更新，请读取最新状态后重试。")
	}
	if value.ActiveEnabled != enabled {
		if _, err = tx.ExecContext(ctx, `UPDATE awcp_settings SET active_enabled=?,version=version+1 WHERE id=1`, enabled); err != nil {
			return value, err
		}
		value.ActiveEnabled = enabled
		value.Version++
	}
	return value, tx.Commit()
}
