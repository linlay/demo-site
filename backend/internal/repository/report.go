package repository

import (
	"context"
	"strings"
	"time"

	"demo-site/backend/internal/model"
)

const metricsSQL = `count(*),coalesce(sum(amount_cents),0),coalesce(sum(status='approved'),0),coalesce(sum(overdue),0),avg(duration_hours)`

func (s *Store) Report(ctx context.Context, hash, generation string, f model.ReportFilter, now time.Time) (model.Report, error) {
	return s.ReportFor(ctx, model.Access{CookieHash: hash}, generation, f, now)
}

func (s *Store) ReportFor(ctx context.Context, access model.Access, generation string, f model.ReportFilter, now time.Time) (model.Report, error) {
	result := model.Report{Generation: generation, Filter: f, Groups: []model.ReportGroup{}, Items: []model.ReportEntry{}}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	session, err := loadAccess(ctx, tx, access, now)
	if err != nil {
		return result, err
	}
	if session.Generation != generation {
		return result, model.Failure(409, "session.generation-conflict", "数据已重置，请刷新。")
	}
	result.Revision = session.Revision
	where := []string{"session_id=?"}
	args := []any{session.ID}
	for _, field := range []struct{ column, operator, value string }{{"created_on", ">=", f.From}, {"created_on", "<=", f.To}, {"department_id", "=", f.DepartmentID}, {"scenario_id", "=", f.ScenarioID}, {"status", "=", f.Status}} {
		if field.value != "" {
			where = append(where, field.column+field.operator+"?")
			args = append(args, field.value)
		}
	}
	clause := " FROM report_entries WHERE " + strings.Join(where, " AND ")
	m := &result.Summary
	if err = tx.QueryRowContext(ctx, "SELECT "+metricsSQL+clause, args...).Scan(&m.Count, &m.AmountCents, &m.Approved, &m.Overdue, &m.AverageHours); err != nil {
		return result, err
	}
	group := map[string]string{"month": "substr(created_on,1,7)", "department": "department_id", "scenario": "scenario_id", "status": "status"}[f.GroupBy]
	if group == "" {
		return result, model.Invalid("groupBy", "分组方式无效。")
	}
	rows, err := tx.QueryContext(ctx, "SELECT "+group+","+metricsSQL+clause+" GROUP BY "+group+" ORDER BY "+group, args...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var g model.ReportGroup
		if err = rows.Scan(&g.Key, &g.Count, &g.AmountCents, &g.Approved, &g.Overdue, &g.AverageHours); err != nil {
			rows.Close()
			return result, err
		}
		result.Groups = append(result.Groups, g)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()
	pageArgs := append(append([]any{}, args...), f.PageSize, (f.Page-1)*f.PageSize)
	rows, err = tx.QueryContext(ctx, `SELECT id,scenario_id,department_id,owner_id,title,status,amount_cents,created_on,duration_hours,overdue`+clause+` ORDER BY created_on DESC,id ASC LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var e model.ReportEntry
		if err = rows.Scan(&e.ID, &e.ScenarioID, &e.DepartmentID, &e.OwnerID, &e.Title, &e.Status, &e.AmountCents, &e.CreatedOn, &e.DurationHours, &e.Overdue); err != nil {
			rows.Close()
			return result, err
		}
		result.Items = append(result.Items, e)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()
	if _, err = tx.ExecContext(ctx, `UPDATE demo_sessions SET expires_at=? WHERE id=?`, now.Add(SessionLifetime).Unix(), session.ID); err != nil {
		return result, err
	}
	if access.CookieHash != "" {
		if _, err = tx.ExecContext(ctx, `UPDATE browser_sessions SET expires_at=? WHERE token_hash=?`, now.Add(SessionLifetime).Unix(), access.CookieHash); err != nil {
			return result, err
		}
	}
	return result, tx.Commit()
}
