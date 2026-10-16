package repository

import (
	"demo-site/backend/internal/model"
	"fmt"
)

func (b *BusinessTx) seedCorrectionApprovals(at string) error {
	samples := []struct{ applicant, department, reviewer, title, description string }{
		{"EMP-003", "DEP-002", "EMP-005", "先进制造行业调研资料补充", "请补充调研访谈记录和数据来源后重新提交。"},
		{"EMP-006", "DEP-003", "EMP-004", "华辰科技风险测算口径补充", "请补充压力测试情景和风险指标计算口径。"},
		{"EMP-007", "DEP-002", "EMP-005", "四季度策略报告发布材料补齐", "请补齐报告复核记录与发布范围说明。"},
		{"EMP-008", "DEP-003", "EMP-004", "远航新材项目立项材料补充", "请更新发行方案并补充客户准入核查结论。"},
		{"EMP-009", "DEP-003", "EMP-004", "远航新材尽调底稿补充", "请补充财务底稿索引与访谈纪要。"},
		{"EMP-010", "DEP-003", "EMP-004", "华辰科技项目质控意见回复", "请逐项回复质控问题并关联整改材料。"},
	}
	// Original returned request is assigned back to Lin Yue.
	if err := b.Exec(`INSERT INTO business_tasks(session_id,id,title,assignee_id,source_type,source_id,due_at,status) VALUES(?,'TODO-910000','补正：季度调研资料申请','EMP-001','approval','APPR-002',?,'open')`, b.Session.ID, at); err != nil {
		return err
	}
	for n, s := range samples {
		id := fmt.Sprintf("APPR-%06d", 910001+n)
		task := fmt.Sprintf("APPTODO-%06d", 910001+n)
		a := model.Approval{TemplateID: "office", Fields: map[string]string{}, ID: id, ApplicantID: s.applicant, DepartmentID: s.department, ReviewerID: s.reviewer, Title: s.title, Description: s.description, MaterialIDs: []string{"APMAT-002"}, Status: "returned", BusinessVersion: 2, CreatedAt: at}
		if err := b.SaveApproval(a); err != nil {
			return err
		}
		if err := b.Exec(`INSERT INTO business_tasks(session_id,id,title,assignee_id,source_type,source_id,due_at,status,completed_at,completed_by,outcome) VALUES(?,?,?,?,?,?,?,'done',?,?,'return')`, b.Session.ID, task, "审批："+s.title, s.reviewer, "approval", id, at, at, s.reviewer); err != nil {
			return err
		}
		if err := b.RecordApprovalDecision(id, task, "return", s.reviewer, s.description, 2); err != nil {
			return err
		}
		if err := b.Audit("approval", id, "return", s.reviewer, strptr("submitted"), "returned", 2, s.description); err != nil {
			return err
		}
		if err := b.Exec(`INSERT INTO business_tasks(session_id,id,title,assignee_id,source_type,source_id,due_at,status) VALUES(?,?,?,?,?,?,?,'open')`, b.Session.ID, fmt.Sprintf("TODO-%06d", 910001+n), "补正："+s.title, s.applicant, "approval", id, at); err != nil {
			return err
		}
	}
	return nil
}
