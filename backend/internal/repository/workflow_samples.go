package repository

import (
	"database/sql"
	"demo-site/backend/internal/model"
	"fmt"
	"time"
)

// Seed actionable personal queues once per workspace, including upgrades without reset.
func (b *BusinessTx) seedWorkflowSamples() error {
	var ready int
	err := b.Tx.QueryRowContext(b.Context, `SELECT 1 FROM workflow_samples_initialized WHERE session_id=?`, b.Session.ID).Scan(&ready)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	// Retain history and already handled requests; only distribute open operational work.
	for id, applicant := range map[string]string{
		"APPR-002": "EMP-001", "APPR-910001": "EMP-001", "APPR-910002": "EMP-001", "APPR-910003": "EMP-001",
		"APPR-910004": "EMP-003", "APPR-910005": "EMP-003", "APPR-910006": "EMP-005",
	} {
		if err = b.Exec(`UPDATE approval_requests SET applicant_id=?,department_id=(SELECT department_id FROM employees WHERE session_id=? AND id=?),business_version=business_version+CASE WHEN applicant_id<>? THEN 1 ELSE 0 END WHERE session_id=? AND id=? AND status='returned'`, applicant, b.Session.ID, applicant, applicant, b.Session.ID, id); err != nil {
			return err
		}
	}
	for _, id := range []string{"APPR-900001", "APPR-900003"} {
		if err = b.Exec(`UPDATE approval_requests SET reviewer_id='EMP-004',business_version=business_version+CASE WHEN reviewer_id<>'EMP-004' THEN 1 ELSE 0 END WHERE session_id=? AND id=? AND status='submitted'`, b.Session.ID, id); err != nil {
			return err
		}
	}
	if err = b.Exec(`UPDATE business_tasks SET assignee_id=(SELECT CASE WHEN a.status='returned' THEN a.applicant_id ELSE a.reviewer_id END FROM approval_requests a WHERE a.session_id=business_tasks.session_id AND a.id=business_tasks.source_id) WHERE session_id=? AND status='open' AND source_type='approval'`, b.Session.ID); err != nil {
		return err
	}
	companies := []string{"华辰科技", "远航新材", "嘉和实业", "青禾设备"}
	templates := []string{"risk", "investment", "institution", "suitability", "procurement", "seal", "office"}
	suffixes := []string{"持仓风险复核补充", "融资项目立项材料补充", "机构调研服务安排补充", "产品适当性资料补充", "办公设备采购说明补充", "合作协议用印材料补充", "季度业务协作事项补充"}
	notes := []string{"请补充风险指标的测算依据。", "请补充融资方案及客户准入结论。", "请确认服务日期与沟通安排。", "请更新风险测评及产品匹配依据。", "请补充采购数量和预算依据。", "请补充合同签署及用印说明。", "请补充事项背景与办理计划。"}
	at := b.Now.UTC().Format(time.RFC3339)
	due := b.Now.Add(48 * time.Hour).UTC().Format(time.RFC3339)
	for n := 0; n < 28; n++ {
		kind := n % len(templates)
		company := companies[n/len(templates)]
		applicant := "EMP-001"
		if n >= 16 {
			applicant = "EMP-003"
		}
		if n >= 26 {
			applicant = "EMP-005"
		}
		person, e := b.Employee(applicant)
		if e != nil {
			return e
		}
		reviewer := "EMP-002"
		if n%2 == 1 {
			reviewer = "EMP-004"
		}
		fields := []map[string]string{
			{"riskObject": company + "持仓组合", "riskLevel": "中", "discoveredOn": b.Now.Format("2006-01-02"), "disposition": "核对风险敞口并逐日跟踪"},
			{"projectName": company + "公司债项目", "clientName": company + "股份有限公司", "projectType": "债券发行", "financingAmount": "30000"},
			{"institutionName": company + "有限公司", "serviceType": "机构调研", "serviceDate": b.Now.Add(7 * 24 * time.Hour).Format("2006-01-02"), "serviceContent": "行业交流及经营情况调研"},
			{"clientName": company + "有限公司", "riskRating": "C3 平衡型", "productName": "稳盈中短债集合资产管理计划", "matchResult": "需补充评估"},
			{"itemName": "办公显示器与配套设备", "quantity": "3", "budget": "6800"},
			{"contractName": company + "合作保密协议", "counterparty": company + "有限公司", "contractAmount": "10000", "sealType": "合同专用章"},
			{},
		}[kind]
		id := fmt.Sprintf("APPR-%06d", 920001+n)
		task := fmt.Sprintf("APPTODO-%06d", 920001+n)
		title := company + suffixes[kind]
		if err = b.SaveApproval(model.Approval{ID: id, ApplicantID: applicant, DepartmentID: person.DepartmentID, ReviewerID: reviewer, Title: title, Description: "本次申请已整理业务资料，请按审核意见补充后重新提交。", TemplateID: templates[kind], Fields: fields, MaterialIDs: []string{"APMAT-002"}, Status: "returned", BusinessVersion: 2, CreatedAt: at}); err != nil {
			return err
		}
		if err = b.Exec(`INSERT INTO business_tasks(session_id,id,title,assignee_id,source_type,source_id,due_at,status,completed_at,completed_by,outcome) VALUES(?,?,?,?,'approval',?,?,'done',?,?,'return')`, b.Session.ID, task, "审核："+title, reviewer, id, due, at, reviewer); err != nil {
			return err
		}
		if err = b.RecordApprovalDecision(id, task, "return", reviewer, notes[kind], 2); err != nil {
			return err
		}
		if err = b.Audit("approval", id, "return", reviewer, strptr("submitted"), "returned", 2, notes[kind]); err != nil {
			return err
		}
		if err = b.Exec(`INSERT INTO business_tasks(session_id,id,title,assignee_id,source_type,source_id,due_at,status) VALUES(?,?,?,?,'approval',?,?,'open')`, b.Session.ID, fmt.Sprintf("TODO-%06d", 920001+n), "补充办理："+title, applicant, id, due); err != nil {
			return err
		}
	}
	return b.Exec(`INSERT INTO workflow_samples_initialized VALUES(?)`, b.Session.ID)
}
