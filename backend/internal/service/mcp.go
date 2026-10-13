package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"demo-site/backend/internal/model"
)

type DirectoryFilter struct {
	DepartmentID string `json:"departmentId,omitempty"`
	Query        string `json:"query,omitempty"`
	Page         int    `json:"page,omitempty"`
	PageSize     int    `json:"pageSize,omitempty"`
}
type DirectoryResult struct {
	Generation  string             `json:"generation"`
	Departments []model.Department `json:"departments"`
	Employees   []model.Employee   `json:"employees"`
	Total       int                `json:"total"`
	Page        int                `json:"page"`
	PageSize    int                `json:"pageSize"`
}
type ResetPreview struct {
	Generation        string `json:"generation"`
	RecordCount       int    `json:"recordCount"`
	ConfirmationToken string `json:"confirmationToken"`
	ExpiresAt         string `json:"expiresAt"`
	Warning           string `json:"warning"`
}

func requireScope(p model.Principal, scope string) error {
	if p.Issuer == "" || p.Subject == "" || p.ClientID == "" || !p.HasScope(scope) {
		return model.Failure(403, "action.forbidden", "当前身份没有所需权限。")
	}
	return nil
}
func (s *Sessions) MCPContext(ctx context.Context, p model.Principal) (model.Session, error) {
	if err := requireScope(p, "context:read"); err != nil {
		return model.Session{}, err
	}
	return s.Store.SessionFor(ctx, model.Access{Principal: &p}, s.clock())
}
func (s *Sessions) MCPReport(ctx context.Context, p model.Principal, generation string, f model.ReportFilter) (model.Report, error) {
	if err := requireScope(p, "reports:read"); err != nil {
		return model.Report{}, err
	}
	if generation == "" {
		return model.Report{}, model.Invalid("expectedGeneration", "请先读取当前演示上下文。")
	}
	if err := validateFilter(&f); err != nil {
		return model.Report{}, err
	}
	return s.Store.ReportFor(ctx, model.Access{Principal: &p}, generation, f, s.clock())
}
func (s *Sessions) MCPDirectory(ctx context.Context, p model.Principal, f DirectoryFilter) (DirectoryResult, error) {
	if err := requireScope(p, "directory:read"); err != nil {
		return DirectoryResult{}, err
	}
	if f.Page == 0 {
		f.Page = 1
	}
	if f.PageSize == 0 {
		f.PageSize = 20
	}
	if f.Page < 1 || f.Page > 100000 || f.PageSize < 1 || f.PageSize > 100 || len(f.Query) > 120 {
		return DirectoryResult{}, model.Invalid("filter", "分页或关键词超出范围。")
	}
	if f.DepartmentID != "" && !departmentID.MatchString(f.DepartmentID) {
		return DirectoryResult{}, model.Invalid("departmentId", "部门编号无效。")
	}
	view, err := s.Store.SessionFor(ctx, model.Access{Principal: &p}, s.clock())
	if err != nil {
		return DirectoryResult{}, err
	}
	result := DirectoryResult{Generation: view.Generation, Departments: view.Departments, Employees: []model.Employee{}, Page: f.Page, PageSize: f.PageSize}
	query := strings.ToLower(strings.TrimSpace(f.Query))
	start := (f.Page - 1) * f.PageSize
	for _, e := range view.Employees {
		if f.DepartmentID != "" && e.DepartmentID != f.DepartmentID {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(e.Name+" "+e.ID), query) {
			continue
		}
		if result.Total >= start && len(result.Employees) < f.PageSize {
			result.Employees = append(result.Employees, e)
		}
		result.Total++
	}
	return result, nil
}
func (s *Sessions) MCPResetPreview(ctx context.Context, p model.Principal, generation string) (ResetPreview, error) {
	if err := requireScope(p, "demo:reset"); err != nil {
		return ResetPreview{}, err
	}
	secret := rand.Text() + rand.Text()
	now := s.clock()
	view, err := s.Store.PreviewMCPReset(ctx, p, generation, tokenHash(secret), now)
	if err != nil {
		return ResetPreview{}, err
	}
	return ResetPreview{Generation: view.Generation, RecordCount: view.RecordCount, ConfirmationToken: secret, ExpiresAt: now.Add(5 * time.Minute).UTC().Format(time.RFC3339), Warning: "此操作会恢复当前演示空间，清除其办理数据和任务；请向用户说明后再执行。其他空间不受影响。"}, nil
}
func (s *Sessions) MCPReset(ctx context.Context, p model.Principal, generation, key, confirmation string) (model.Session, error) {
	if err := requireScope(p, "demo:reset"); err != nil {
		return model.Session{}, err
	}
	if generation == "" || !resetKey.MatchString(key) || len(confirmation) < 40 || len(confirmation) > 128 {
		return model.Session{}, model.Invalid("request", "缺少有效的数据版本、幂等键或确认凭据。")
	}
	// Namespace keys by verified identity and client; browser request IDs cannot collide.
	encoded, _ := json.Marshal([]string{p.Issuer, p.Subject, p.ClientID, key})
	return s.Store.ResetFor(ctx, model.Access{Principal: &p}, generation, "mcp:"+tokenHash(string(encoded)), randomID(), tokenHash(confirmation), s.clock())
}
func (s *Sessions) ConnectMCP(ctx context.Context, cookie string, p model.Principal) (model.Session, string, error) {
	if err := requireScope(p, "context:read"); err != nil {
		return model.Session{}, "", err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return model.Session{}, "", err
	}
	next := hex.EncodeToString(secret)
	view, err := s.Store.BindMCP(ctx, tokenHash(cookie), tokenHash(next), p, s.clock())
	if err != nil {
		return view, "", err
	}
	return view, next, nil
}
func (s *Sessions) DisconnectMCP(ctx context.Context, cookie string) error {
	return s.Store.DisconnectMCP(ctx, tokenHash(cookie), s.clock())
}
