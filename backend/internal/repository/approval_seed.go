package repository

import (
	"demo-site/backend/internal/model"
	"fmt"
)

func (b *BusinessTx) seedSecuritiesApprovals(at string) error {
	samples := []struct {
		template, title, description string
		fields                       map[string]string
	}{
		{"risk", "华辰科技持仓集中度超限处置", "持仓集中度触及预警线，建议分三日降低敞口并持续监测。", map[string]string{"riskObject": "华辰科技持仓组合", "riskLevel": "高", "discoveredOn": "2026-09-18", "disposition": "分批降低持仓并每日复核风险指标"}},
		{"investment", "远航新材公司债项目立项", "拟承做远航新材公司债发行，已完成初步客户准入核查。", map[string]string{"projectName": "远航新材公司债", "clientName": "远航新材料股份有限公司", "projectType": "债券发行", "financingAmount": "50000"}},
		{"institution", "汇安资产四季度策略路演", "拟安排宏观与行业研究团队为客户开展四季度策略交流。", map[string]string{"institutionName": "汇安资产管理有限公司", "serviceType": "研究路演", "serviceDate": "2026-10-20", "serviceContent": "四季度宏观展望及先进制造行业交流"}},
		{"suitability", "嘉和实业债券产品适当性复核", "已收集客户风险测评与产品风险说明，请复核匹配结果。", map[string]string{"clientName": "嘉和实业有限公司", "riskRating": "C3 平衡型", "productName": "稳盈中短债集合资产管理计划", "matchResult": "匹配"}},
	}
	for n, s := range samples {
		id := fmt.Sprintf("APPR-%06d", 900001+n)
		task := fmt.Sprintf("APPTODO-%06d", 900001+n)
		applicant, department, reviewer := "EMP-001", "DEP-001", "EMP-002"
		if n == 0 {
			applicant, department, reviewer = "EMP-006", "DEP-003", "EMP-004"
		}
		if n == 1 {
			applicant, department, reviewer = "EMP-008", "DEP-003", "EMP-004"
		}
		if n == 3 {
			reviewer = "EMP-005"
		}
		a := model.Approval{TemplateID: s.template, Fields: s.fields, ID: id, ApplicantID: applicant, DepartmentID: department, ReviewerID: reviewer, Title: s.title, Description: s.description, MaterialIDs: []string{"APMAT-001"}, Status: "submitted", BusinessVersion: 1, CurrentTaskID: &task, CreatedAt: at}
		if err := b.SaveApproval(a); err != nil {
			return err
		}
		if err := b.Exec(`INSERT INTO business_tasks(session_id,id,title,assignee_id,source_type,source_id,due_at,status) VALUES(?,?,?,?,?,?,?,'open')`, b.Session.ID, task, s.title, reviewer, "approval", id, at); err != nil {
			return err
		}
	}
	return nil
}
