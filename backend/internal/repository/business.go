package repository

import (
	"context"
	"database/sql"
	"demo-site/backend/internal/model"
	"encoding/json"
	"fmt"
	"time"
)

type businessValidationKey struct{}

func BusinessValidation(ctx context.Context) context.Context {
	return context.WithValue(ctx, businessValidationKey{}, true)
}
func isBusinessValidation(ctx context.Context) bool {
	valid, _ := ctx.Value(businessValidationKey{}).(bool)
	return valid
}

type BusinessTx struct {
	Context context.Context
	Tx      *sql.Tx
	Session model.Session
	Access  model.Access
	Now     time.Time
}

func (s *Store) Business(ctx context.Context, access model.Access, generation string, now time.Time, fn func(*BusinessTx) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	view, err := loadAccess(ctx, tx, access, now)
	if err != nil {
		return err
	}
	if view.Generation != generation {
		return model.Failure(409, "session.generation-conflict", "数据已重置，请重新读取上下文。")
	}
	b := &BusinessTx{Context: ctx, Tx: tx, Session: view, Access: access, Now: now}
	if err = b.initialize(); err != nil {
		return err
	}
	if err = fn(b); err != nil {
		return err
	}
	if isBusinessValidation(ctx) {
		return nil
	}
	return tx.Commit()
}
func (b *BusinessTx) Exec(query string, args ...any) error {
	_, err := b.Tx.ExecContext(b.Context, query, args...)
	return err
}
func (b *BusinessTx) Employee(id string) (model.Employee, error) {
	var e model.Employee
	var roles string
	err := b.Tx.QueryRowContext(b.Context, `SELECT id,department_id,name,roles,active FROM employees WHERE session_id=? AND id=?`, b.Session.ID, id).Scan(&e.ID, &e.DepartmentID, &e.Name, &roles, &e.Active)
	if err == sql.ErrNoRows || err == nil && !e.Active {
		return e, model.Invalid("actorId", "操作人不存在或已停用。")
	}
	if err != nil {
		return e, err
	}
	err = json.Unmarshal([]byte(roles), &e.Roles)
	return e, err
}
func (b *BusinessTx) Manager(department, exclude string) (string, error) {
	var id string
	err := b.Tx.QueryRowContext(b.Context, `SELECT id FROM employees WHERE session_id=? AND department_id=? AND active=1 AND id<>? AND EXISTS(SELECT 1 FROM json_each(roles) WHERE value='manager') ORDER BY id LIMIT 1`, b.Session.ID, department, exclude).Scan(&id)
	if err == sql.ErrNoRows {
		return "", model.Invalid("actorId", "所属部门没有可用审批主管。")
	}
	return id, err
}
func (b *BusinessTx) Identity() string {
	if p := b.Access.Principal; p != nil {
		v, _ := json.Marshal([]string{p.Issuer, p.Subject, p.ClientID})
		return string(v)
	}
	// Browser cookies can rotate; all browsers in this fictional workspace share
	// the same business idempotency namespace, independent from MCP clients.
	return "browser"
}
func (b *BusinessTx) Replay(key, operation, fingerprint string) (*model.BusinessResult, error) {
	var op, fp, result string
	err := b.Tx.QueryRowContext(b.Context, `SELECT operation,fingerprint,result FROM business_receipts WHERE session_id=? AND generation=? AND identity=? AND key=?`, b.Session.ID, b.Session.Generation, b.Identity(), key).Scan(&op, &fp, &result)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if op != operation || fp != fingerprint {
		return nil, model.Failure(409, "action.idempotency-conflict", "业务幂等键已用于其他操作或参数。")
	}
	var out model.BusinessResult
	err = json.Unmarshal([]byte(result), &out)
	return &out, err
}
func (b *BusinessTx) CommitResult(kind, operation, key, fingerprint, actor, id, status string, version int, task *string) (model.BusinessResult, error) {
	if isBusinessValidation(b.Context) {
		return model.BusinessResult{ID: id, Status: status, BusinessVersion: version, TaskID: task, Generation: b.Session.Generation, Revision: b.Session.Revision}, nil
	}
	source := "browser"
	if b.Access.Principal != nil {
		source = "mcp"
	}
	resources := []string{"todos", "done", "business-analysis", kind}
	if err := AppendEvent(b.Context, b.Tx, &b.Session, "business.changed", source, key, resources, b.Now); err != nil {
		return model.BusinessResult{}, err
	}
	result := model.BusinessResult{ID: id, Status: status, BusinessVersion: version, TaskID: task, Generation: b.Session.Generation, Revision: b.Session.Revision}
	raw, err := json.Marshal(result)
	if err != nil {
		return result, err
	}
	if err = b.Exec(`INSERT INTO business_receipts VALUES(?,?,?,?,?,?,?)`, b.Session.ID, b.Session.Generation, b.Identity(), key, operation, fingerprint, string(raw)); err != nil {
		return result, err
	}
	if b.Access.Principal != nil {
		err = auditMCP(b.Context, b.Tx, *b.Access.Principal, b.Session.ID, operation, "completed", b.Now)
	}
	return result, err
}
func (b *BusinessTx) History(kind, id string) ([]model.BusinessHistory, error) {
	result := []model.BusinessHistory{}
	rows, err := b.Tx.QueryContext(b.Context, `SELECT action,actor_id,at,from_status,to_status,business_version,note FROM business_history WHERE session_id=? AND source_type=? AND source_id=? ORDER BY sequence`, b.Session.ID, kind, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var h model.BusinessHistory
		if err = rows.Scan(&h.Action, &h.ActorID, &h.At, &h.FromStatus, &h.ToStatus, &h.BusinessVersion, &h.Note); err != nil {
			return nil, err
		}
		result = append(result, h)
	}
	return result, rows.Err()
}
func (b *BusinessTx) Audit(kind, id, action, actor string, from *string, to string, version int, note string) error {
	return b.Exec(`INSERT INTO business_history(session_id,source_type,source_id,action,actor_id,at,from_status,to_status,business_version,note) VALUES(?,?,?,?,?,?,?,?,?,?)`, b.Session.ID, kind, id, action, actor, b.Now.UTC().Format(time.RFC3339), from, to, version, note)
}
func (b *BusinessTx) NextID(prefix, table string) (string, error) {
	var next int
	// Table/prefix names are internal constants selected by domain services.
	err := b.Tx.QueryRowContext(b.Context, "SELECT coalesce(max(CAST(substr(id,?) AS INTEGER)),0)+1 FROM "+table+" WHERE session_id=? AND id LIKE ?", len(prefix)+2, b.Session.ID, prefix+"-%").Scan(&next)
	return fmt.Sprintf("%s-%03d", prefix, next), err
}
func (b *BusinessTx) NewTask(kind, id, title, assignee string) (*string, error) {
	task, err := b.NextID("TODO", "business_tasks")
	if err != nil {
		return nil, err
	}
	err = b.Exec(`INSERT INTO business_tasks(session_id,id,title,assignee_id,source_type,source_id,due_at,status) VALUES(?,?,?,?,?,?,?,'open')`, b.Session.ID, task, title, assignee, kind, id, b.Now.Add(24*time.Hour).UTC().Format(time.RFC3339))
	return &task, err
}
func (b *BusinessTx) CloseTask(kind, id, task, actor, outcome string) error {
	result, err := b.Tx.ExecContext(b.Context, `UPDATE business_tasks SET status='done',completed_at=?,completed_by=?,outcome=? WHERE session_id=? AND id=? AND source_type=? AND source_id=? AND status='open'`, b.Now.UTC().Format(time.RFC3339), actor, outcome, b.Session.ID, task, kind, id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n != 1 {
		return model.Failure(409, "action.task-missing", "当前任务不存在或已处理。")
	}
	return err
}
func (b *BusinessTx) Tasks(actor model.Employee, status, kind, id string) ([]model.BusinessTask, error) {
	rows, err := b.Tx.QueryContext(b.Context, `SELECT t.id,t.title,t.assignee_id,t.source_type,t.source_id,t.due_at,t.status,t.completed_at,t.completed_by,t.outcome,coalesce(a.status,f.status),coalesce(a.business_version,f.business_version) FROM business_tasks t JOIN employees e ON e.session_id=t.session_id AND e.id=t.assignee_id LEFT JOIN approval_requests a ON a.session_id=t.session_id AND a.id=t.source_id AND t.source_type='approval' LEFT JOIN business_forms f ON f.session_id=t.session_id AND f.id=t.source_id AND t.source_type IN ('travel','expense') WHERE t.session_id=? AND (?='' OR t.status=?) AND (?='' OR (t.source_type=? AND t.source_id=?)) AND e.active=1 AND e.department_id=? AND (t.assignee_id=? OR ?=1) ORDER BY CASE WHEN t.status='done' THEN t.completed_at ELSE t.due_at END DESC,t.id`, b.Session.ID, status, status, kind, kind, id, actor.DepartmentID, actor.ID, hasRole(actor, "manager"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.BusinessTask{}
	for rows.Next() {
		var t model.BusinessTask
		if err = rows.Scan(&t.ID, &t.Title, &t.AssigneeID, &t.SourceType, &t.SourceID, &t.DueAt, &t.Status, &t.CompletedAt, &t.CompletedBy, &t.Outcome, &t.SourceStatus, &t.SourceVersion); err != nil {
			return nil, err
		}
		t.ScenarioID = "O09"
		if t.SourceType == "approval" {
			t.ScenarioID = "O08"
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func hasRole(e model.Employee, role string) bool {
	for _, r := range e.Roles {
		if r == role {
			return true
		}
	}
	return false
}
func (b *BusinessTx) Materials() ([]model.BusinessMaterial, error) {
	out := []model.BusinessMaterial{}
	rows, err := b.Tx.QueryContext(b.Context, `SELECT id,name FROM approval_materials WHERE session_id=? ORDER BY id`, b.Session.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m model.BusinessMaterial
		if err = rows.Scan(&m.ID, &m.Name); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func (b *BusinessTx) Approval(id string) (model.Approval, error) {
	var a model.Approval
	err := b.Tx.QueryRowContext(b.Context, `SELECT id,applicant_id,department_id,reviewer_id,title,description,status,business_version,current_task_id,created_at FROM approval_requests WHERE session_id=? AND id=?`, b.Session.ID, id).Scan(&a.ID, &a.ApplicantID, &a.DepartmentID, &a.ReviewerID, &a.Title, &a.Description, &a.Status, &a.BusinessVersion, &a.CurrentTaskID, &a.CreatedAt)
	if err == sql.ErrNoRows {
		return a, model.Failure(404, "action.approval-not-found", "申请不存在。")
	}
	if err != nil {
		return a, err
	}
	a.MaterialIDs = []string{}
	rows, err := b.Tx.QueryContext(b.Context, `SELECT material_id FROM approval_request_materials WHERE session_id=? AND request_id=? ORDER BY position`, b.Session.ID, id)
	if err != nil {
		return a, err
	}
	defer rows.Close()
	for rows.Next() {
		var m string
		if err = rows.Scan(&m); err != nil {
			return a, err
		}
		a.MaterialIDs = append(a.MaterialIDs, m)
	}
	return a, rows.Err()
}
func (b *BusinessTx) SaveApproval(a model.Approval) error {
	if err := b.Exec(`INSERT INTO approval_requests VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,id) DO UPDATE SET reviewer_id=excluded.reviewer_id,title=excluded.title,description=excluded.description,status=excluded.status,business_version=excluded.business_version,current_task_id=excluded.current_task_id`, b.Session.ID, a.ID, a.ApplicantID, a.DepartmentID, a.ReviewerID, a.Title, a.Description, a.Status, a.BusinessVersion, a.CurrentTaskID, a.CreatedAt); err != nil {
		return err
	}
	if err := b.Exec(`DELETE FROM approval_request_materials WHERE session_id=? AND request_id=?`, b.Session.ID, a.ID); err != nil {
		return err
	}
	for n, m := range a.MaterialIDs {
		if err := b.Exec(`INSERT INTO approval_request_materials VALUES(?,?,?,?)`, b.Session.ID, a.ID, m, n); err != nil {
			return err
		}
	}
	return nil
}
func (b *BusinessTx) Form(id string) (model.Form, error) {
	var f model.Form
	err := b.Tx.QueryRowContext(b.Context, `SELECT id,kind,applicant_id,department_id,reviewer_id,status,business_version,amount_cents,current_task_id,created_at FROM business_forms WHERE session_id=? AND id=?`, b.Session.ID, id).Scan(&f.ID, &f.Kind, &f.ApplicantID, &f.DepartmentID, &f.ReviewerID, &f.Status, &f.BusinessVersion, &f.AmountCents, &f.CurrentTaskID, &f.CreatedAt)
	if err == sql.ErrNoRows {
		return f, model.Failure(404, "action.form-not-found", "单据不存在。")
	}
	return f, err
}
func (b *BusinessTx) SaveForm(f model.Form) error {
	return b.Exec(`INSERT INTO business_forms VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,id) DO UPDATE SET applicant_id=excluded.applicant_id,department_id=excluded.department_id,status=excluded.status,business_version=excluded.business_version,amount_cents=excluded.amount_cents,current_task_id=excluded.current_task_id,reviewer_id=excluded.reviewer_id`, b.Session.ID, f.ID, f.Kind, f.ApplicantID, f.DepartmentID, f.ReviewerID, f.Status, f.BusinessVersion, f.AmountCents, f.CurrentTaskID, f.CreatedAt)
}
func (b *BusinessTx) Travel(id string) (model.Travel, error) {
	f, err := b.Form(id)
	t := model.Travel{Form: f, TravelerIDs: []string{}}
	if err != nil {
		return t, err
	}
	if f.Kind != "travel" {
		return t, model.Invalid("id", "不是差旅单据。")
	}
	err = b.Tx.QueryRowContext(b.Context, `SELECT origin,destination,start_at,end_at FROM travel_requests WHERE session_id=? AND form_id=?`, b.Session.ID, id).Scan(&t.Origin, &t.Destination, &t.StartAt, &t.EndAt)
	if err != nil {
		return t, err
	}
	rows, err := b.Tx.QueryContext(b.Context, `SELECT employee_id FROM travel_travelers WHERE session_id=? AND form_id=? ORDER BY position`, b.Session.ID, id)
	if err != nil {
		return t, err
	}
	defer rows.Close()
	for rows.Next() {
		var e string
		if err = rows.Scan(&e); err != nil {
			return t, err
		}
		t.TravelerIDs = append(t.TravelerIDs, e)
	}
	return t, rows.Err()
}
func (b *BusinessTx) SaveTravel(t model.Travel) error {
	if err := b.SaveForm(t.Form); err != nil {
		return err
	}
	if err := b.Exec(`INSERT INTO travel_requests VALUES(?,?,?,?,?,?)`, b.Session.ID, t.ID, t.Origin, t.Destination, t.StartAt, t.EndAt); err != nil {
		return err
	}
	for n, e := range t.TravelerIDs {
		if err := b.Exec(`INSERT INTO travel_travelers VALUES(?,?,?,?)`, b.Session.ID, t.ID, e, n); err != nil {
			return err
		}
	}
	return nil
}
func (b *BusinessTx) Assets(id string) ([]model.BusinessAsset, error) {
	out := []model.BusinessAsset{}
	rows, err := b.Tx.QueryContext(b.Context, `SELECT id,coalesce(owner_id,''),filename FROM business_assets WHERE session_id=? AND owner_id=? ORDER BY id`, b.Session.ID, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var a model.BusinessAsset
		if err = rows.Scan(&a.ID, &a.OwnerID, &a.Filename); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func (b *BusinessTx) Expense(id string) (model.Expense, error) {
	f, err := b.Form(id)
	e := model.Expense{Form: f, Receipts: []model.Receipt{}, LineItems: []model.ExpenseLine{}}
	if err != nil {
		return e, err
	}
	if f.Kind != "expense" {
		return e, model.Invalid("id", "不是费用单据。")
	}
	if err = b.Tx.QueryRowContext(b.Context, `SELECT travel_form_id,checked_version FROM expense_claims WHERE session_id=? AND form_id=?`, b.Session.ID, id).Scan(&e.TravelFormID, &e.CheckedVersion); err != nil {
		return e, err
	}
	rows, err := b.Tx.QueryContext(b.Context, `SELECT invoice_no,asset_id,amount_cents FROM expense_receipts WHERE session_id=? AND form_id=? ORDER BY position`, b.Session.ID, id)
	if err != nil {
		return e, err
	}
	for rows.Next() {
		var r model.Receipt
		if err = rows.Scan(&r.InvoiceNo, &r.AssetID, &r.AmountCents); err != nil {
			rows.Close()
			return e, err
		}
		e.Receipts = append(e.Receipts, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return e, err
	}
	rows, err = b.Tx.QueryContext(b.Context, `SELECT category,invoice_no,amount_cents FROM expense_lines WHERE session_id=? AND form_id=? ORDER BY position`, b.Session.ID, id)
	if err != nil {
		return e, err
	}
	defer rows.Close()
	for rows.Next() {
		var l model.ExpenseLine
		if err = rows.Scan(&l.Category, &l.InvoiceNo, &l.AmountCents); err != nil {
			return e, err
		}
		e.LineItems = append(e.LineItems, l)
	}
	return e, rows.Err()
}
func (b *BusinessTx) SaveExpense(e model.Expense) error {
	if err := b.SaveForm(e.Form); err != nil {
		return err
	}
	if err := b.Exec(`INSERT INTO expense_claims VALUES(?,?,?,?) ON CONFLICT(session_id,form_id) DO UPDATE SET checked_version=excluded.checked_version`, b.Session.ID, e.ID, e.TravelFormID, e.CheckedVersion); err != nil {
		return err
	}
	for _, table := range []string{"expense_lines", "expense_receipts"} {
		if err := b.Exec(`DELETE FROM `+table+` WHERE session_id=? AND form_id=?`, b.Session.ID, e.ID); err != nil {
			return err
		}
	}
	for n, r := range e.Receipts {
		if err := b.Exec(`INSERT INTO expense_receipts VALUES(?,?,?,?,?,?)`, b.Session.ID, e.ID, r.InvoiceNo, r.AssetID, r.AmountCents, n); err != nil {
			return err
		}
	}
	for n, l := range e.LineItems {
		if err := b.Exec(`INSERT INTO expense_lines VALUES(?,?,?,?,?,?)`, b.Session.ID, e.ID, n, l.Category, l.InvoiceNo, l.AmountCents); err != nil {
			return err
		}
	}
	return nil
}
func (b *BusinessTx) IDs(kind, actor string) ([]string, error) {
	query := `SELECT id FROM business_forms WHERE session_id=? AND kind=? AND (applicant_id=? OR reviewer_id=?) ORDER BY created_at DESC,id`
	args := []any{b.Session.ID, kind, actor, actor}
	if kind == "approval" {
		query = `SELECT id FROM approval_requests WHERE session_id=? AND (applicant_id=? OR reviewer_id=?) ORDER BY created_at DESC,id`
		args = []any{b.Session.ID, actor, actor}
	}
	rows, err := b.Tx.QueryContext(b.Context, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
func (b *BusinessTx) initialize() error {
	var initialized int
	err := b.Tx.QueryRowContext(b.Context, `SELECT 1 FROM business_initialized WHERE session_id=?`, b.Session.ID).Scan(&initialized)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	for _, m := range []model.BusinessMaterial{{ID: "APMAT-001", Name: "虚构采购说明"}, {ID: "APMAT-002", Name: "虚构补正说明"}} {
		if err = b.Exec(`INSERT INTO approval_materials VALUES(?,?,?)`, b.Session.ID, m.ID, m.Name); err != nil {
			return err
		}
	}
	at := b.Session.SimulatedAt
	originalTime := b.Now
	if seededAt, parseErr := time.Parse(time.RFC3339, at); parseErr == nil {
		b.Now = seededAt
		defer func() { b.Now = originalTime }()
	}

	for n, status := range []string{"submitted", "returned", "approved"} {
		id := fmt.Sprintf("APPR-%03d", n+1)
		title := []string{"虚构办公用品申请", "虚构资料补正申请", "虚构已批准申请"}[n]
		task := fmt.Sprintf("APPTODO-%03d", n+1)
		var current *string
		version := 2
		if n == 0 {
			current = &task
			version = 1
		}
		a := model.Approval{ID: id, ApplicantID: "EMP-001", DepartmentID: "DEP-001", ReviewerID: "EMP-002", Title: title, Description: "用于演示的申请说明。", MaterialIDs: []string{"APMAT-001"}, Status: status, BusinessVersion: version, CurrentTaskID: current, CreatedAt: at}
		if err = b.SaveApproval(a); err != nil {
			return err
		}
		taskStatus := "done"
		var completed, by, outcome *string
		if n == 0 {
			taskStatus = "open"
		} else {
			completed = &at
			actor := "EMP-002"
			by = &actor
			outcome = &status
		}
		if err = b.Exec(`INSERT INTO business_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)`, b.Session.ID, task, "审批"+title, "EMP-002", "approval", id, at, taskStatus, completed, by, outcome); err != nil {
			return err
		}
		if n > 0 {
			if err = b.RecordApprovalDecision(id, task, map[bool]string{true: "return", false: "approve"}[n == 1], "EMP-002", "虚构初始办理记录", version); err != nil {
				return err
			}
			if err = b.Audit("approval", id, map[bool]string{true: "return", false: "approve"}[n == 1], "EMP-002", strptr("submitted"), status, version, "虚构初始办理记录"); err != nil {
				return err
			}
		}
	}
	t := model.Travel{Form: model.Form{ID: "FORM-001", Kind: "travel", ApplicantID: "EMP-001", DepartmentID: "DEP-001", ReviewerID: "EMP-002", Status: "submitted", BusinessVersion: 1, AmountCents: 12000, CurrentTaskID: strptr("TODO-001"), CreatedAt: at}, Origin: "上海", Destination: "北京", StartAt: "2026-09-22T09:00:00+08:00", EndAt: "2026-09-23T18:00:00+08:00", TravelerIDs: []string{"EMP-001"}}
	if err = b.SaveTravel(t); err != nil {
		return err
	}
	if err = b.Exec(`INSERT INTO business_tasks(session_id,id,title,assignee_id,source_type,source_id,due_at,status) VALUES(?,'TODO-001','审批演示出差申请','EMP-002','travel','FORM-001',?,'open')`, b.Session.ID, at); err != nil {
		return err
	}
	draft := model.Travel{Form: model.Form{ID: "FORM-002", Kind: "travel", ApplicantID: "EMP-001", DepartmentID: "DEP-001", ReviewerID: "EMP-002", Status: "draft", BusinessVersion: 1, AmountCents: 20000, CreatedAt: at}, TravelerIDs: []string{"EMP-001"}}
	if err = b.SaveTravel(draft); err != nil {
		return err
	}
	for n, name := range []string{"演示行程说明.txt", "演示交通票据.txt", "演示住宿票据.txt"} {
		if err = b.Exec(`INSERT INTO business_assets VALUES(?,?,?,?)`, b.Session.ID, fmt.Sprintf("AST-%03d", n+1), t.ID, name); err != nil {
			return err
		}
	}
	if err = b.Exec(`INSERT INTO business_assets VALUES(?, 'AST-004', NULL, '待关联的演示凭证.txt')`, b.Session.ID); err != nil {
		return err
	}
	return b.Exec(`INSERT INTO business_initialized VALUES(?)`, b.Session.ID)
}
func strptr(s string) *string { return &s }

func (b *BusinessTx) DraftAssets(id string) ([]model.BusinessAsset, error) {
	rows, err := b.Tx.QueryContext(b.Context, `SELECT id,coalesce(owner_id,''),filename FROM business_assets WHERE session_id=? AND (owner_id=? OR owner_id IS NULL) ORDER BY id`, b.Session.ID, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.BusinessAsset{}
	for rows.Next() {
		var v model.BusinessAsset
		if err = rows.Scan(&v.ID, &v.OwnerID, &v.Filename); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (b *BusinessTx) RecordApprovalDecision(request, task, action, actor, opinion string, version int) error {
	id, err := b.NextID("APDEC", "approval_decisions")
	if err != nil {
		return err
	}
	return b.Exec(`INSERT INTO approval_decisions VALUES(?,?,?,?,?,?,?,?,?)`, b.Session.ID, id, request, task, action, actor, opinion, version, b.Now.UTC().Format(time.RFC3339))
}
func (b *BusinessTx) ApprovalDecisions(id string) ([]model.ApprovalDecision, error) {
	rows, err := b.Tx.QueryContext(b.Context, `SELECT id,task_id,action,actor_id,opinion,business_version,decided_at FROM approval_decisions WHERE session_id=? AND request_id=? ORDER BY decided_at,id`, b.Session.ID, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.ApprovalDecision{}
	for rows.Next() {
		var d model.ApprovalDecision
		if err = rows.Scan(&d.ID, &d.TaskID, &d.Action, &d.ActorID, &d.Opinion, &d.BusinessVersion, &d.DecidedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
