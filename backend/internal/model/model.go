package model

// Session contains public metadata only. The cookie and its digest never leave the HTTP/storage layer.
type Session struct {
	ID             string       `json:"id"`
	Generation     string       `json:"generation"`
	Seed           int64        `json:"seed"`
	DatasetVersion string       `json:"datasetVersion"`
	Profile        string       `json:"profile"`
	SimulatedAt    string       `json:"simulatedAt"`
	ExpiresAt      string       `json:"expiresAt"`
	Employees      []Employee   `json:"employees"`
	Departments    []Department `json:"departments"`
	RecordCount    int          `json:"recordCount"`
	MCPAvailable   bool         `json:"mcpAvailable"`
	MCPConnectURL  string       `json:"mcpConnectUrl,omitempty"`
	Revision       int64        `json:"revision"`
	EventCursor    string       `json:"eventCursor"`
	OperationID    string       `json:"operationId,omitempty"`
}
type WorkspaceEvent struct {
	ID          string   `json:"id"`
	WorkspaceID string   `json:"workspaceId"`
	Generation  string   `json:"generation"`
	Revision    int64    `json:"revision"`
	Type        string   `json:"type"`
	Source      string   `json:"source"`
	OperationID string   `json:"operationId,omitempty"`
	Resources   []string `json:"resources"`
}
type Employee struct {
	ID           string   `json:"id"`
	DepartmentID string   `json:"departmentId"`
	Name         string   `json:"name"`
	Roles        []string `json:"roles"`
	Active       bool     `json:"active"`
}
type Department struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type FieldError struct {
	Path     []string `json:"path"`
	Messages []string `json:"messages"`
}
type Error struct {
	Status      int          `json:"-"`
	Code        string       `json:"code"`
	Message     string       `json:"message"`
	FieldErrors []FieldError `json:"fieldErrors,omitempty"`
}

func (e *Error) Error() string { return e.Message }
func Failure(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}
func Invalid(field, message string) *Error {
	return &Error{Status: 400, Code: "request.invalid", Message: message, FieldErrors: []FieldError{{Path: []string{field}, Messages: []string{message}}}}
}

type ReportFilter struct {
	DataSource   string `json:"dataSource,omitempty"`
	Kind         string `json:"kind,omitempty"`
	From         string `json:"from"`
	To           string `json:"to"`
	DepartmentID string `json:"departmentId"`
	ScenarioID   string `json:"scenarioId"`
	Status       string `json:"status"`
	GroupBy      string `json:"groupBy"`
	Page         int    `json:"page"`
	PageSize     int    `json:"pageSize"`
}
type Metrics struct {
	Count        int      `json:"count"`
	AmountCents  int64    `json:"amountCents"`
	Approved     int      `json:"approved"`
	Overdue      int      `json:"overdue"`
	AverageHours *float64 `json:"averageHours"`
}
type ReportGroup struct {
	Key string `json:"key"`
	Metrics
}
type ReportEntry struct {
	Kind          string `json:"kind,omitempty"`
	ID            string `json:"id"`
	ScenarioID    string `json:"scenarioId"`
	DepartmentID  string `json:"departmentId"`
	OwnerID       string `json:"ownerId"`
	Title         string `json:"title"`
	Status        string `json:"status"`
	AmountCents   int64  `json:"amountCents"`
	CreatedOn     string `json:"createdOn"`
	DurationHours *int   `json:"durationHours"`
	Overdue       bool   `json:"overdue"`
}
type Report struct {
	Revision   int64         `json:"revision"`
	Generation string        `json:"generation"`
	Filter     ReportFilter  `json:"filter"`
	Summary    Metrics       `json:"summary"`
	Groups     []ReportGroup `json:"groups"`
	Items      []ReportEntry `json:"items"`
}
