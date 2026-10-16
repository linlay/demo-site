package service

import (
	"context"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
)

func approvalTemplates() []model.ApprovalTemplate {
	text := func(id, label string) model.ApprovalField {
		return model.ApprovalField{ID: id, Label: label, Type: "text"}
	}
	number := func(id, label string) model.ApprovalField {
		return model.ApprovalField{ID: id, Label: label, Type: "number"}
	}
	date := func(id, label string) model.ApprovalField {
		return model.ApprovalField{ID: id, Label: label, Type: "date"}
	}
	choice := func(id, label string, options ...string) model.ApprovalField {
		return model.ApprovalField{ID: id, Label: label, Type: "select", Options: options}
	}
	return []model.ApprovalTemplate{
		{ID: "risk", Name: "风险处置审批", Category: "风险监控", Description: "提交风险事项、核查结论与处置方案，申请负责人审批。", Fields: []model.ApprovalField{text("riskObject", "监控对象"), choice("riskLevel", "风险等级", "低", "中", "高"), date("discoveredOn", "发现日期"), text("disposition", "处置方案")}},
		{ID: "investment", Name: "投行项目立项", Category: "投行项目", Description: "登记拟承做项目、客户与融资方案，发起立项审批。", Fields: []model.ApprovalField{text("projectName", "项目名称"), text("clientName", "客户名称"), choice("projectType", "项目类型", "IPO", "再融资", "债券发行", "并购重组"), number("financingAmount", "拟融资金额（万元）")}},
		{ID: "institution", Name: "机构服务申请", Category: "机构服务", Description: "申请机构调研、研究路演或专项服务，确认服务安排。", Fields: []model.ApprovalField{text("institutionName", "机构名称"), choice("serviceType", "服务类型", "研究路演", "机构调研", "专题交流"), date("serviceDate", "服务日期"), text("serviceContent", "服务安排")}},
		{ID: "suitability", Name: "客户适当性审核", Category: "客户适当性", Description: "提交客户风险评估、拟购买产品及匹配结论供复核。", Fields: []model.ApprovalField{text("clientName", "客户名称"), choice("riskRating", "客户风险等级", "C1 保守型", "C2 稳健型", "C3 平衡型", "C4 成长型", "C5 进取型"), text("productName", "拟购买产品"), choice("matchResult", "匹配结论", "匹配", "需补充评估", "不匹配，暂停办理")}},
		{ID: "procurement", Name: "采购申请", Category: "日常办公", Description: "填写采购物品、数量与预算，提交采购审批。", Fields: []model.ApprovalField{text("itemName", "采购内容"), number("quantity", "采购数量"), number("budget", "预算金额（元）")}},
		{ID: "seal", Name: "合同用印申请", Category: "日常办公", Description: "填写合同信息与用印需求，提交审核。", Fields: []model.ApprovalField{text("contractName", "合同名称"), text("counterparty", "合同相对方"), number("contractAmount", "合同金额（元）"), choice("sealType", "印章类型", "公章", "合同专用章")}},
		{ID: "office", Name: "综合事项申请", Category: "日常办公", Description: "适用于其他需要负责人审批的协作事项。", Fields: []model.ApprovalField{}},
	}
}
func (s *Sessions) ApprovalTemplates(ctx context.Context, a model.Access, in model.GenerationInput) ([]model.ApprovalTemplate, error) {
	if err := businessAccess(a, "business:read", in.ExpectedGeneration); err != nil {
		return nil, err
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error { return nil })
	return approvalTemplates(), err
}
func validateApprovalFields(id string, fields map[string]string) error {
	templates := approvalTemplates()
	index := slices.IndexFunc(templates, func(t model.ApprovalTemplate) bool { return t.ID == id })
	if index < 0 {
		return model.Invalid("templateId", "申请类型不存在，请重新选择。")
	}
	template := templates[index]
	if len(fields) != len(template.Fields) {
		return model.Invalid("fields", "请完整填写该类申请的业务信息。")
	}
	for _, field := range template.Fields {
		value := strings.TrimSpace(fields[field.ID])
		if err := bounded("fields."+field.ID, value, 300); err != nil {
			return err
		}
		if field.Type == "select" && !slices.Contains(field.Options, value) {
			return model.Invalid("fields."+field.ID, "请选择有效选项。")
		}
		if field.Type == "number" {
			n, err := strconv.ParseFloat(value, 64)
			if err != nil || !(n > 0 && n <= 1e12) {
				return model.Invalid("fields."+field.ID, "请输入大于0的有效金额或数量。")
			}
		}
		if field.ID == "quantity" {
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 {
				return model.Invalid("fields.quantity", "数量须为正整数。")
			}
		}
		if field.Type == "date" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return model.Invalid("fields."+field.ID, "请输入有效日期。")
			}
		}
	}
	return nil
}

// ApprovalCenter gathers authorized source records in a single workspace snapshot.
// Completed approvals use task history, so returned/resubmitted requests remain in reviewed.
func (s *Sessions) ApprovalCenter(ctx context.Context, a model.Access, in model.ApprovalCenterQuery) (model.BusinessPage[model.BusinessRecord], error) {
	var out model.BusinessPage[model.BusinessRecord]
	if err := businessAccess(a, "business:read", in.ExpectedGeneration); err != nil {
		return out, err
	}
	if err := queryDefaults(&in.BusinessQuery); err != nil {
		return out, err
	}
	if !slices.Contains([]string{"pending", "reviewed", "initiated", "handling"}, in.View) {
		return out, model.Invalid("view", "审批视图无效。")
	}
	if in.TemplateID != "" && !slices.Contains([]string{"risk", "investment", "institution", "suitability", "procurement", "seal", "office", "travel", "expense"}, in.TemplateID) {
		return out, model.Invalid("templateId", "申请类型无效。")
	}
	err := s.Store.Business(ctx, a, in.ExpectedGeneration, s.clock(), func(b *repository.BusinessTx) error {
		actor, err := b.Employee(in.ActorID)
		if err != nil {
			return err
		}
		reviewed := map[string]bool{}
		tasks, err := b.Tasks(actor, "done", "", "")
		if err != nil {
			return err
		}
		for _, task := range tasks {
			if task.CompletedBy != nil && *task.CompletedBy == actor.ID && task.Outcome != nil && (*task.Outcome == "approve" || *task.Outcome == "return" || *task.Outcome == "approved" || *task.Outcome == "returned") {
				reviewed[task.SourceType+":"+task.SourceID] = true
			}
		}
		items := []model.BusinessRecord{}
		for _, kind := range []string{"approval", "travel", "expense"} {
			ids, err := b.IDs(kind, actor.ID)
			if err != nil {
				return err
			}
			for _, id := range ids {
				var r model.BusinessRecord
				switch kind {
				case "approval":
					v, e := b.Approval(id)
					if e != nil {
						return e
					}
					r = approvalRecord(v)
				case "travel":
					v, e := b.Travel(id)
					if e != nil {
						return e
					}
					r = travelRecord(v)
				case "expense":
					v, e := b.Expense(id)
					if e != nil {
						return e
					}
					r = expenseRecord(v)
				}
				if in.View == "pending" && (r.ReviewerID != actor.ID || r.Status != "submitted") {
					continue
				}
				if in.View == "reviewed" && !reviewed[kind+":"+id] {
					continue
				}
				if in.View == "initiated" && r.ApplicantID != actor.ID {
					continue
				}
				if in.View == "handling" && (r.ApplicantID != actor.ID || r.Status != "returned") {
					continue
				}
				template := r.TemplateID
				if kind != "approval" {
					template = kind
				}
				if in.TemplateID != "" && template != in.TemplateID {
					continue
				}
				if !matches(in.BusinessQuery, r.Status, r.Title+" "+r.ID) {
					continue
				}
				items = append(items, r)
			}
		}
		sort.Slice(items, func(i, j int) bool {
			if items[i].CreatedAt == items[j].CreatedAt {
				return items[i].ID < items[j].ID
			}
			return items[i].CreatedAt > items[j].CreatedAt
		})
		out = page(items, in.BusinessQuery, b)
		return nil
	})
	return out, err
}

// Former reviewers retain access to requests they actually handled, even after reassignment.
func canReadApproval(b *repository.BusinessTx, actor model.Employee, v model.Approval) error {
	if err := canRead(actor, v.ApplicantID, v.ReviewerID); err == nil {
		return nil
	}
	var count int
	if err := b.Tx.QueryRowContext(b.Context, `SELECT count(*) FROM approval_decisions WHERE session_id=? AND request_id=? AND actor_id=? AND action IN ('approve','return')`, b.Session.ID, v.ID, actor.ID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	return canRead(actor, v.ApplicantID, v.ReviewerID)
}
