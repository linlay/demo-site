package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"demo-site/backend/internal/model"
)

func seedSession(ctx context.Context, tx *sql.Tx, s model.Session) error {
	departments, employees, records := 3, 10, 24000
	if s.Profile == "acceptance" {
		departments, employees, records = 3, 10, 48
	}
	departmentNames := []string{"客户服务部", "研究部", "运营部"}
	for n := 1; n <= departments; n++ {
		name := fmt.Sprintf("业务部%02d", n)
		if n <= len(departmentNames) {
			name = departmentNames[n-1]
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO departments(session_id,id,name) VALUES(?,?,?)`, s.ID, fmt.Sprintf("DEP-%03d", n), name); err != nil {
			return err
		}
	}
	for n := 1; n <= employees; n++ {
		roles := []string{"employee"}
		if n > 12 && n%15 == 0 {
			roles = append(roles, "manager")
		}
		department := 1 + (n-1)%departments
		if n <= 10 {
			department = []int{1, 1, 2, 3, 2, 3, 2, 3, 3, 3, 3, 3}[n-1]
			roles = [][]string{
				{"employee", "institution-sales"}, {"employee", "manager", "event-organizer"},
				{"employee", "analyst", "research-service"}, {"employee", "reviewer", "hr", "it-coordinator", "risk-reviewer", "ib-committee"},
				{"quality", "risk-investigator"}, {"compliance", "it-agent", "risk-monitor"},
				{"publisher"}, {"ib-manager"}, {"ib-member"}, {"ib-quality"}, {"ib-committee"}, {"employee"},
			}[n-1]
		}
		name := fmt.Sprintf("员工%03d", n)
		if n <= 10 {
			name = []string{"林悦", "陈明", "王晨", "赵敏", "刘洋", "周宁", "徐嘉", "张远", "李桐", "孙岚"}[n-1]
		}
		if n == 4 || n == 5 {
			roles = append(roles, "manager")
		}
		if n > 4 {
			roles = append(roles, "employee")
		}
		encoded, err := json.Marshal(roles)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO employees(session_id,id,department_id,name,roles,active) VALUES(?,?,?,?,?,?)`, s.ID, fmt.Sprintf("EMP-%03d", n), fmt.Sprintf("DEP-%03d", department), name, string(encoded), n != 12); err != nil {
			return err
		}
	}
	insert, err := tx.PrepareContext(ctx, `INSERT INTO report_entries(session_id,id,scenario_id,department_id,owner_id,title,status,amount_cents,created_on,duration_hours,overdue) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer insert.Close()
	random := uint32(s.Seed)
	// Use high bits to avoid modulo correlations in the generator's low bits.
	next := func() uint32 { random = random*1664525 + 1013904223; return random >> 8 }
	start := time.Date(2024, 9, 20, 0, 0, 0, 0, time.UTC)
	scenarios := []string{"O08", "O09", "O11", "O12", "O15"}
	names := []string{"通用审批", "差旅报销", "采购申请", "合同用印", "IT 服务"}
	statuses := []string{"approved", "approved", "approved", "pending", "returned", "withdrawn"}
	for n := 1; n <= records; n++ {
		owner := 1 + int(next()%uint32(employees))
		department := 1 + (owner-1)%departments
		if owner <= 10 {
			department = []int{1, 1, 2, 3, 2, 3, 2, 3, 3, 3, 3, 3}[owner-1]
		}
		scenario := int(next() % uint32(len(scenarios)))
		status := statuses[next()%uint32(len(statuses))]
		amount := int64(10000 + next()%2000000)
		date := start.AddDate(0, 0, int(next()%730)).Format("2006-01-02")
		var duration any
		if status == "approved" {
			duration = int(next()%120) + 1
		}
		overdue := status == "pending" && next()%3 == 0
		if _, err = insert.ExecContext(ctx, s.ID, fmt.Sprintf("HIST-%06d", n), scenarios[scenario], fmt.Sprintf("DEP-%03d", department), fmt.Sprintf("EMP-%03d", owner), fmt.Sprintf("%s · %06d", names[scenario], n), status, amount, date, duration, overdue); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE employees SET active=CASE WHEN id IN ('EMP-001','EMP-002','EMP-003','EMP-004','EMP-005','EMP-006') THEN 1 ELSE 0 END WHERE session_id=?`, s.ID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE employees SET roles=CASE WHEN id IN ('EMP-001','EMP-003','EMP-005') THEN '["employee","workflow-initiator"]' WHEN id IN ('EMP-002','EMP-004') THEN '["manager","workflow-approver"]' ELSE '["workflow-analyst"]' END WHERE session_id=? AND id IN ('EMP-001','EMP-002','EMP-003','EMP-004','EMP-005','EMP-006')`, s.ID)
	return err
}
