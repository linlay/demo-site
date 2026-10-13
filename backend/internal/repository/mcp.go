package repository

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"time"

	"demo-site/backend/internal/model"
)

func auditMCP(ctx context.Context, tx *sql.Tx, p model.Principal, sessionID, operation, outcome string, now time.Time) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO mcp_audit_events VALUES(?,?,?,?,?,?,?,?)`, rand.Text(), p.Issuer, p.Subject, p.ClientID, sessionID, operation, outcome, now.Unix())
	return err
}

// BindMCP is called only after authenticated, browser-bound login consent.
// A returning identity resumes its existing space. Rotating the browser credential
// avoids sharing cookie secrets with OAuth clients or storing recoverable cookies.
func (s *Store) BindMCP(ctx context.Context, cookieHash, newCookieHash string, p model.Principal, now time.Time) (model.Session, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return model.Session{}, err
	}
	defer tx.Rollback()
	view, err := loadSession(ctx, tx, cookieHash, now)
	if err != nil {
		return view, err
	}
	if p.Issuer == "" || p.Subject == "" || p.ClientID == "" || !p.HasScope("context:read") {
		return view, model.Failure(403, "workspace.forbidden", "此身份未获演示访问授权。")
	}
	var existing string
	err = tx.QueryRowContext(ctx, `SELECT session_id FROM mcp_workspace_bindings WHERE issuer=? AND subject=?`, p.Issuer, p.Subject).Scan(&existing)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return view, err
	}
	if existing != "" {
		var active int
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM demo_sessions WHERE id=? AND expires_at>?`, existing, now.Unix()).Scan(&active); err != nil {
			return view, err
		}
		if active == 1 {
			if _, err = tx.ExecContext(ctx, `INSERT INTO browser_sessions VALUES(?,?,?)`, newCookieHash, existing, now.Add(SessionLifetime).Unix()); err != nil {
				return view, err
			}
			view, err = loadSession(ctx, tx, newCookieHash, now)
			if err != nil {
				return view, err
			}
		}
	}
	var owner string
	err = tx.QueryRowContext(ctx, `SELECT subject FROM mcp_workspace_bindings WHERE session_id=? AND NOT (issuer=? AND subject=?)`, view.ID, p.Issuer, p.Subject).Scan(&owner)
	if err == nil {
		return view, model.Failure(403, "workspace.already-linked", "当前空间已关联其他账号，请先创建新的演示会话。")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return view, err
	}
	// Rotate only the browser performing this login. Other browsers keep their
	// own credentials while observing the same workspace.
	if _, err = tx.ExecContext(ctx, `DELETE FROM browser_sessions WHERE token_hash=?`, cookieHash); err != nil {
		return view, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO browser_sessions VALUES(?,?,?) ON CONFLICT(token_hash) DO UPDATE SET session_id=excluded.session_id,expires_at=excluded.expires_at`, newCookieHash, view.ID, now.Add(SessionLifetime).Unix()); err != nil {
		return view, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE demo_sessions SET token_hash=?,expires_at=? WHERE id=?`, newCookieHash, now.Add(SessionLifetime).Unix(), view.ID); err != nil {
		return view, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO mcp_workspace_bindings VALUES(?,?,?,1,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET session_id=excluded.session_id,enabled=1,updated_at=excluded.updated_at`, p.Issuer, p.Subject, view.ID, now.Unix(), now.Unix())
	if err != nil {
		return view, err
	}
	if err = fillSession(ctx, tx, &view); err != nil {
		return view, err
	}
	view.ExpiresAt = now.Add(SessionLifetime).UTC().Format(time.RFC3339)
	if err = auditMCP(ctx, tx, p, view.ID, "workspace.connect", "completed", now); err != nil {
		return view, err
	}
	return view, tx.Commit()
}

func (s *Store) DisconnectMCP(ctx context.Context, cookieHash string, now time.Time) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	view, err := loadSession(ctx, tx, cookieHash, now)
	if err != nil {
		return err
	}
	var p model.Principal
	err = tx.QueryRowContext(ctx, `SELECT issuer,subject FROM mcp_workspace_bindings WHERE session_id=?`, view.ID).Scan(&p.Issuer, &p.Subject)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Failure(403, "workspace.not-linked", "当前空间未关联 MCP 账号。")
	}
	if err != nil {
		return err
	}
	p.ClientID = "browser"
	if _, err = tx.ExecContext(ctx, `DELETE FROM demo_oauth_tokens WHERE issuer=? AND subject=?`, p.Issuer, p.Subject); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM demo_oauth_codes WHERE issuer=?`, p.Issuer); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE mcp_workspace_bindings SET enabled=0,updated_at=? WHERE session_id=?`, now.Unix(), view.ID); err != nil {
		return err
	}
	if err = auditMCP(ctx, tx, p, view.ID, "workspace.disconnect", "completed", now); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) PreviewMCPReset(ctx context.Context, p model.Principal, expected, hash string, now time.Time) (model.Session, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return model.Session{}, err
	}
	defer tx.Rollback()
	view, err := loadAccess(ctx, tx, model.Access{Principal: &p}, now)
	if err != nil {
		return view, err
	}
	if !p.HasScope("demo:reset") {
		return view, model.Failure(403, "action.forbidden", "缺少重置权限。")
	}
	if view.Generation != expected {
		return view, model.Failure(409, "session.generation-conflict", "数据已重置，请重新读取上下文。")
	}
	if err = fillSession(ctx, tx, &view); err != nil {
		return view, err
	}
	// Bound per identity to prevent unbounded confirmation storage.
	if _, err = tx.ExecContext(ctx, `DELETE FROM mcp_reset_confirmations WHERE issuer=? AND subject=? AND request_key=''`, p.Issuer, p.Subject); err != nil {
		return view, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO mcp_reset_confirmations(token_hash,issuer,subject,client_id,session_id,generation,expires_at) VALUES(?,?,?,?,?,?,?)`, hash, p.Issuer, p.Subject, p.ClientID, view.ID, view.Generation, now.Add(5*time.Minute).Unix())
	if err != nil {
		return view, err
	}
	return view, tx.Commit()
}

func authorizeReset(ctx context.Context, tx *sql.Tx, p model.Principal, view model.Session, expected, key, hash string, now time.Time) error {
	if !p.HasScope("demo:reset") {
		return model.Failure(403, "action.forbidden", "缺少重置权限。")
	}
	var savedKey string
	var expires int64
	err := tx.QueryRowContext(ctx, `SELECT request_key,expires_at FROM mcp_reset_confirmations WHERE token_hash=? AND issuer=? AND subject=? AND client_id=? AND session_id=? AND generation=?`, hash, p.Issuer, p.Subject, p.ClientID, view.ID, expected).Scan(&savedKey, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Failure(403, "reset.confirmation-invalid", "请先预览本次重置并确认其影响。")
	}
	if err != nil {
		return err
	}
	if savedKey != "" {
		if savedKey != key {
			return model.Failure(409, "idempotency.conflict", "确认凭据已用于其他重置请求。")
		}
		return nil
	}
	if expires <= now.Unix() {
		return model.Failure(409, "reset.confirmation-expired", "重置预览已过期，请重新预览。")
	}
	_, err = tx.ExecContext(ctx, `UPDATE mcp_reset_confirmations SET request_key=? WHERE token_hash=?`, key, hash)
	return err
}
