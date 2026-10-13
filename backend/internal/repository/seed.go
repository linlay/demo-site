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
	departments, employees, records := 20, 300, 24000
	if s.Profile == "acceptance" {
		departments, employees, records = 3, 12, 48
	}
	departmentNames := []string{"客户服务部", "研究部", "运营部"}
	for n := 1; n <= departments; n++ {
		name := fmt.Sprintf("演示部门%02d", n)
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
		if n <= 12 {
			department = []int{1, 1, 2, 3, 2, 3, 2, 3, 3, 3, 3, 3}[n-1]
			roles = [][]string{
				{"employee", "institution-sales"}, {"employee", "manager", "event-organizer"},
				{"employee", "analyst", "research-service"}, {"employee", "reviewer", "hr", "it-coordinator", "risk-reviewer"},
				{"quality", "risk-investigator"}, {"compliance", "it-agent", "risk-monitor"},
				{"publisher"}, {"ib-manager"}, {"ib-member"}, {"ib-quality"}, {"ib-committee"}, {"employee"},
			}[n-1]
		}
		name := fmt.Sprintf("演示人员%03d", n)
		if n <= 12 {
			name = []string{"演示员工甲", "演示主管乙", "演示分析师丙", "演示复核员丁", "演示质审员戊", "演示合规员己", "演示发布员庚", "演示投行经理辛", "演示尽调成员壬", "演示质控员癸", "演示内核员子", "演示离职人员丑"}[n-1]
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
		if owner <= 12 {
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
		if _, err = insert.ExecContext(ctx, s.ID, fmt.Sprintf("HIST-%06d", n), scenarios[scenario], fmt.Sprintf("DEP-%03d", department), fmt.Sprintf("EMP-%03d", owner), fmt.Sprintf("%s历史样例 %06d", names[scenario], n), status, amount, date, duration, overdue); err != nil {
			return err
		}
	}
	return nil
}
