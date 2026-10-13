package service

import (
	"demo-site/backend/internal/model"
	"regexp"
	"slices"
	"time"
)

var departmentID = regexp.MustCompile(`^DEP-[0-9]{3}$`)

func validateFilter(f *model.ReportFilter) error {
	for _, field := range []struct{ name, value string }{{"from", f.From}, {"to", f.To}} {
		if field.value != "" {
			if _, err := time.Parse("2006-01-02", field.value); err != nil {
				return model.Invalid(field.name, "日期必须为有效的 YYYY-MM-DD。")
			}
		}
	}
	if f.From != "" && f.To != "" && f.From > f.To {
		return model.Invalid("to", "结束日期不能早于开始日期。")
	}
	if f.DepartmentID != "" && !departmentID.MatchString(f.DepartmentID) {
		return model.Invalid("departmentId", "部门编号无效。")
	}
	if f.ScenarioID != "" && !slices.Contains([]string{"O08", "O09", "O11", "O12", "O15"}, f.ScenarioID) {
		return model.Invalid("scenarioId", "不支持的历史样本类型。")
	}
	if f.Status != "" && !slices.Contains([]string{"pending", "approved", "returned", "withdrawn"}, f.Status) {
		return model.Invalid("status", "状态无效。")
	}
	if !slices.Contains([]string{"month", "department", "scenario", "status"}, f.GroupBy) {
		return model.Invalid("groupBy", "分组方式无效。")
	}
	if f.Page < 1 || f.Page > 100000 {
		return model.Invalid("page", "页码超出范围。")
	}
	if f.PageSize < 1 || f.PageSize > 100 {
		return model.Invalid("pageSize", "每页条数必须为 1～100。")
	}
	return nil
}
