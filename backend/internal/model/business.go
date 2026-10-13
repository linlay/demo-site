package model

// Business contracts are shared by HTTP and MCP. Actor IDs select fictional
// roles within the authorized workspace, never a real user's identity.
type BusinessQuery struct {
	ExpectedGeneration string `json:"expectedGeneration"`
	ActorID            string `json:"actorId"`
	Query              string `json:"query,omitempty"`
	Status             string `json:"status,omitempty"`
	Page               int    `json:"page,omitempty"`
	PageSize           int    `json:"pageSize,omitempty"`
}
type BusinessRead struct {
	ExpectedGeneration string `json:"expectedGeneration"`
	ActorID            string `json:"actorId"`
	ID                 string `json:"id"`
}
type BusinessMutation struct {
	ExpectedGeneration string `json:"expectedGeneration"`
	ActorID            string `json:"actorId"`
	ExpectedVersion    int    `json:"expectedVersion"`
	IdempotencyKey     string `json:"idempotencyKey"`
}
type ApprovalSubmit struct {
	BusinessMutation
	RequestID   *string  `json:"requestId"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	MaterialIDs []string `json:"materialIds"`
}
type BusinessDecision struct {
	BusinessMutation
	ID      string `json:"id"`
	Opinion string `json:"opinion"`
}
type TravelSubmit struct {
	BusinessMutation
	DepartmentID         string   `json:"departmentId"`
	TravelerIDs          []string `json:"travelerIds"`
	Origin               string   `json:"origin"`
	Destination          string   `json:"destination"`
	StartAt              string   `json:"startAt"`
	EndAt                string   `json:"endAt"`
	EstimatedAmountCents int64    `json:"estimatedAmountCents"`
}
type Receipt struct {
	InvoiceNo   string `json:"invoiceNo"`
	AssetID     string `json:"assetId"`
	AmountCents int64  `json:"amountCents"`
}
type ExpenseLine struct {
	Category    string `json:"category"`
	InvoiceNo   string `json:"invoiceNo"`
	AmountCents int64  `json:"amountCents"`
}
type ExpenseCheck struct {
	BusinessMutation
	ExpenseFormID      string        `json:"expenseFormId,omitempty"`
	TravelFormID       string        `json:"travelFormId"`
	Receipts           []Receipt     `json:"receipts"`
	LineItems          []ExpenseLine `json:"lineItems"`
	DeclaredTotalCents int64         `json:"declaredTotalCents"`
}
type BusinessResult struct {
	ID              string  `json:"id"`
	Status          string  `json:"status"`
	BusinessVersion int     `json:"businessVersion"`
	TaskID          *string `json:"taskId"`
	Generation      string  `json:"generation"`
	Revision        int64   `json:"revision"`
}
type BusinessTask struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	AssigneeID    string  `json:"assigneeId"`
	SourceType    string  `json:"sourceType"`
	SourceID      string  `json:"sourceId"`
	ScenarioID    string  `json:"scenarioId"`
	DueAt         string  `json:"dueAt"`
	Status        string  `json:"status"`
	CompletedAt   *string `json:"completedAt"`
	CompletedBy   *string `json:"completedBy"`
	Outcome       *string `json:"outcome"`
	SourceStatus  string  `json:"sourceStatus"`
	SourceVersion int     `json:"sourceVersion"`
}
type BusinessHistory struct {
	Action          string  `json:"action"`
	ActorID         string  `json:"actorId"`
	At              string  `json:"at"`
	FromStatus      *string `json:"fromStatus"`
	ToStatus        string  `json:"toStatus"`
	BusinessVersion int     `json:"businessVersion"`
	Note            string  `json:"note"`
}
type Approval struct {
	ID              string   `json:"id"`
	ApplicantID     string   `json:"applicantId"`
	DepartmentID    string   `json:"departmentId"`
	ReviewerID      string   `json:"reviewerId"`
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	MaterialIDs     []string `json:"materialIds"`
	Status          string   `json:"status"`
	BusinessVersion int      `json:"businessVersion"`
	CurrentTaskID   *string  `json:"currentTaskId"`
	CreatedAt       string   `json:"createdAt"`
}
type Form struct {
	ID              string  `json:"id"`
	Kind            string  `json:"kind"`
	ApplicantID     string  `json:"applicantId"`
	DepartmentID    string  `json:"departmentId"`
	ReviewerID      string  `json:"reviewerId"`
	Status          string  `json:"status"`
	BusinessVersion int     `json:"businessVersion"`
	AmountCents     int64   `json:"amountCents"`
	CurrentTaskID   *string `json:"currentTaskId"`
	CreatedAt       string  `json:"createdAt"`
}
type Travel struct {
	Form
	Origin      string   `json:"origin"`
	Destination string   `json:"destination"`
	StartAt     string   `json:"startAt"`
	EndAt       string   `json:"endAt"`
	TravelerIDs []string `json:"travelerIds"`
}
type Expense struct {
	Form
	TravelFormID   string        `json:"travelFormId"`
	CheckedVersion int           `json:"checkedVersion"`
	Receipts       []Receipt     `json:"receipts"`
	LineItems      []ExpenseLine `json:"lineItems"`
}
type BusinessPage[T any] struct {
	Items      []T    `json:"items"`
	Total      int    `json:"total"`
	Page       int    `json:"page"`
	PageSize   int    `json:"pageSize"`
	Generation string `json:"generation"`
	Revision   int64  `json:"revision"`
}
type BusinessDetail[T any] struct {
	Decisions  []ApprovalDecision `json:"decisions,omitempty"`
	Assets     []BusinessAsset    `json:"assets,omitempty"`
	Item       T                  `json:"item"`
	Tasks      []BusinessTask     `json:"tasks"`
	History    []BusinessHistory  `json:"history"`
	Generation string             `json:"generation"`
	Revision   int64              `json:"revision"`
}
type BusinessMaterial struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type BusinessAsset struct {
	ID       string `json:"id"`
	OwnerID  string `json:"ownerId"`
	Filename string `json:"filename"`
}
type WorkbenchSummary struct {
	Pending    int    `json:"pending"`
	Done       int    `json:"done"`
	Overdue    int    `json:"overdue"`
	Generation string `json:"generation"`
	Revision   int64  `json:"revision"`
}

type GenerationInput struct {
	ExpectedGeneration string `json:"expectedGeneration"`
}
type AssetRegister struct {
	BusinessMutation
	TravelFormID string `json:"travelFormId"`
	Filename     string `json:"filename"`
}

type TodoComplete struct {
	BusinessMutation
	TodoID string `json:"todoId"`
}
type TodoSummaryInput struct {
	ExpectedGeneration string `json:"expectedGeneration"`
	ActorID            string `json:"actorId"`
	Date               string `json:"date"`
}
type TodoSummaryItem struct {
	TodoID      string  `json:"todoId"`
	SourceID    string  `json:"sourceId"`
	Category    string  `json:"category"`
	DueAt       string  `json:"dueAt"`
	CompletedAt *string `json:"completedAt"`
}
type TodoSummary struct {
	Date    string            `json:"date"`
	ActorID string            `json:"actorId"`
	Done    int               `json:"done"`
	Pending int               `json:"pending"`
	Overdue int               `json:"overdue"`
	Items   []TodoSummaryItem `json:"items"`
}

type TravelDraft struct {
	BusinessMutation
	FormID       string   `json:"formId"`
	ApplicantID  string   `json:"applicantId"`
	DepartmentID string   `json:"departmentId"`
	AmountCents  int64    `json:"amountCents"`
	AssetIDs     []string `json:"assetIds"`
}

type ApprovalDecision struct {
	ID              string `json:"id"`
	TaskID          string `json:"taskId"`
	Action          string `json:"action"`
	ActorID         string `json:"actorId"`
	Opinion         string `json:"opinion"`
	BusinessVersion int    `json:"businessVersion"`
	DecidedAt       string `json:"decidedAt"`
}

// TaskQuery is a primitive task lookup. Dates filter due dates for open tasks
// and completion dates for done tasks, using Asia/Shanghai calendar dates.
type TaskQuery struct {
	ExpectedGeneration string `json:"expectedGeneration"`
	ActorID            string `json:"actorId"`
	Status             string `json:"status,omitempty"`
	Kind               string `json:"kind,omitempty"`
	From               string `json:"from,omitempty"`
	To                 string `json:"to,omitempty"`
	Query              string `json:"query,omitempty"`
	Page               int    `json:"page,omitempty"`
	PageSize           int    `json:"pageSize,omitempty"`
}

type RecordQuery struct {
	BusinessQuery
	Kind string `json:"kind"`
	ID   string `json:"id,omitempty"`
}
type WorkflowTransition struct {
	BusinessDecision
	Kind   string `json:"kind"`
	Action string `json:"action"`
}
type BusinessRecord struct {
	ID              string             `json:"id"`
	Kind            string             `json:"kind"`
	ApplicantID     string             `json:"applicantId"`
	DepartmentID    string             `json:"departmentId"`
	ReviewerID      string             `json:"reviewerId"`
	Title           string             `json:"title"`
	Status          string             `json:"status"`
	BusinessVersion int                `json:"businessVersion"`
	CurrentTaskID   *string            `json:"currentTaskId"`
	CreatedAt       string             `json:"createdAt"`
	AmountCents     *int64             `json:"amountCents,omitempty"`
	Description     string             `json:"description,omitempty"`
	MaterialIDs     []string           `json:"materialIds,omitempty"`
	Origin          string             `json:"origin,omitempty"`
	Destination     string             `json:"destination,omitempty"`
	StartAt         string             `json:"startAt,omitempty"`
	EndAt           string             `json:"endAt,omitempty"`
	TravelerIDs     []string           `json:"travelerIds,omitempty"`
	TravelFormID    string             `json:"travelFormId,omitempty"`
	CheckedVersion  *int               `json:"checkedVersion,omitempty"`
	Receipts        []Receipt          `json:"receipts,omitempty"`
	LineItems       []ExpenseLine      `json:"lineItems,omitempty"`
	Tasks           []BusinessTask     `json:"tasks,omitempty"`
	History         []BusinessHistory  `json:"history,omitempty"`
	Decisions       []ApprovalDecision `json:"decisions,omitempty"`
	Assets          []BusinessAsset    `json:"assets,omitempty"`
}
type RecordsPage struct {
	Kind       string             `json:"kind"`
	Items      []BusinessRecord   `json:"items"`
	Total      int                `json:"total"`
	Page       int                `json:"page"`
	PageSize   int                `json:"pageSize"`
	Generation string             `json:"generation"`
	Revision   int64              `json:"revision"`
	Materials  []BusinessMaterial `json:"materials,omitempty"`
}
