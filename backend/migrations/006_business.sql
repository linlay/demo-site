CREATE TABLE business_initialized (
    session_id TEXT PRIMARY KEY REFERENCES demo_sessions(id) ON DELETE CASCADE
);
CREATE TABLE approval_materials (
    session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
    id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(session_id,id)
);
CREATE TABLE approval_requests (
    session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
    id TEXT NOT NULL, applicant_id TEXT NOT NULL, department_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('submitted','approved','returned','withdrawn')),
    business_version INTEGER NOT NULL CHECK(business_version>0), current_task_id TEXT,
    created_at TEXT NOT NULL, PRIMARY KEY(session_id,id),
    FOREIGN KEY(session_id,applicant_id) REFERENCES employees(session_id,id),
    FOREIGN KEY(session_id,reviewer_id) REFERENCES employees(session_id,id)
);
CREATE TABLE approval_request_materials (
    session_id TEXT NOT NULL, request_id TEXT NOT NULL, material_id TEXT NOT NULL,
    position INTEGER NOT NULL, PRIMARY KEY(session_id,request_id,material_id),
    FOREIGN KEY(session_id,request_id) REFERENCES approval_requests(session_id,id) ON DELETE CASCADE,
    FOREIGN KEY(session_id,material_id) REFERENCES approval_materials(session_id,id)
);
CREATE TABLE business_forms (
    session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
    id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('travel','expense')),
    applicant_id TEXT NOT NULL, department_id TEXT NOT NULL, reviewer_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','submitted','approved','returned')),
    business_version INTEGER NOT NULL CHECK(business_version>0),
    amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), current_task_id TEXT,
    created_at TEXT NOT NULL, PRIMARY KEY(session_id,id),
    FOREIGN KEY(session_id,applicant_id) REFERENCES employees(session_id,id),
    FOREIGN KEY(session_id,reviewer_id) REFERENCES employees(session_id,id)
);
CREATE TABLE travel_requests (
    session_id TEXT NOT NULL, form_id TEXT NOT NULL, origin TEXT NOT NULL,
    destination TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
    PRIMARY KEY(session_id,form_id),
    FOREIGN KEY(session_id,form_id) REFERENCES business_forms(session_id,id) ON DELETE CASCADE
);
CREATE TABLE travel_travelers (
    session_id TEXT NOT NULL, form_id TEXT NOT NULL, employee_id TEXT NOT NULL, position INTEGER NOT NULL,
    PRIMARY KEY(session_id,form_id,employee_id),
    FOREIGN KEY(session_id,form_id) REFERENCES travel_requests(session_id,form_id) ON DELETE CASCADE,
    FOREIGN KEY(session_id,employee_id) REFERENCES employees(session_id,id)
);
CREATE TABLE business_assets (
    session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE, id TEXT NOT NULL, owner_id TEXT, filename TEXT NOT NULL,
    PRIMARY KEY(session_id,id),
    FOREIGN KEY(session_id,owner_id) REFERENCES business_forms(session_id,id) ON DELETE CASCADE
);
CREATE TABLE expense_claims (
    session_id TEXT NOT NULL, form_id TEXT NOT NULL, travel_form_id TEXT NOT NULL, checked_version INTEGER NOT NULL,
    PRIMARY KEY(session_id,form_id),
    FOREIGN KEY(session_id,form_id) REFERENCES business_forms(session_id,id) ON DELETE CASCADE,
    FOREIGN KEY(session_id,travel_form_id) REFERENCES travel_requests(session_id,form_id)
);
CREATE TABLE expense_receipts (
    session_id TEXT NOT NULL, form_id TEXT NOT NULL, invoice_no TEXT NOT NULL, asset_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents>0), position INTEGER NOT NULL,
    PRIMARY KEY(session_id,invoice_no), UNIQUE(session_id,asset_id),
    FOREIGN KEY(session_id,form_id) REFERENCES expense_claims(session_id,form_id) ON DELETE CASCADE,
    FOREIGN KEY(session_id,asset_id) REFERENCES business_assets(session_id,id)
);
CREATE TABLE expense_lines (
    session_id TEXT NOT NULL, form_id TEXT NOT NULL, position INTEGER NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('transport','hotel','meal','other')),
    invoice_no TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
    PRIMARY KEY(session_id,form_id,position),
    FOREIGN KEY(session_id,form_id) REFERENCES expense_claims(session_id,form_id) ON DELETE CASCADE
);
CREATE TABLE business_tasks (
    session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
    id TEXT NOT NULL, title TEXT NOT NULL, assignee_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('approval','travel','expense')),
    source_id TEXT NOT NULL, due_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','done')),
    completed_at TEXT, completed_by TEXT, outcome TEXT,
    PRIMARY KEY(session_id,id),
    FOREIGN KEY(session_id,assignee_id) REFERENCES employees(session_id,id)
);
CREATE UNIQUE INDEX business_task_open ON business_tasks(session_id,source_type,source_id) WHERE status='open';
CREATE INDEX business_task_assignee ON business_tasks(session_id,assignee_id,status,due_at);
CREATE TABLE business_history (
    session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
    action TEXT NOT NULL, actor_id TEXT NOT NULL, at TEXT NOT NULL,
    from_status TEXT, to_status TEXT NOT NULL, business_version INTEGER NOT NULL, note TEXT NOT NULL
);
CREATE INDEX business_history_source ON business_history(session_id,source_type,source_id,sequence);
CREATE TABLE business_receipts (
    session_id TEXT NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
    generation TEXT NOT NULL, identity TEXT NOT NULL, key TEXT NOT NULL,
    operation TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY(session_id,generation,identity,key)
);
-- A query view over authoritative business tables, separate from historical fixtures.
CREATE VIEW business_report_entries AS
SELECT a.session_id,a.id,'O08' AS scenario_id,a.department_id,a.applicant_id AS owner_id,a.title,
       CASE a.status WHEN 'submitted' THEN 'pending' ELSE a.status END AS status,
       0 AS amount_cents,substr(a.created_at,1,10) AS created_on,
       CASE WHEN a.status='approved' THEN CAST((strftime('%s',(SELECT max(at) FROM business_history h WHERE h.session_id=a.session_id AND h.source_type='approval' AND h.source_id=a.id AND h.action='approve'))-strftime('%s',a.created_at))/3600 AS INTEGER) END AS duration_hours,
       coalesce((SELECT min(due_at) FROM business_tasks t WHERE t.session_id=a.session_id AND t.source_type='approval' AND t.source_id=a.id AND t.status='open'),'') AS due_at
FROM approval_requests a
UNION ALL
SELECT f.session_id,f.id,'O09',f.department_id,f.applicant_id,
       CASE f.kind WHEN 'travel' THEN '差旅：'||tr.origin||' → '||tr.destination ELSE '报销：'||e.travel_form_id END,
       CASE f.status WHEN 'submitted' THEN 'pending' ELSE f.status END,
       f.amount_cents,substr(f.created_at,1,10),
       CASE WHEN f.status='approved' THEN CAST((strftime('%s',(SELECT max(at) FROM business_history h WHERE h.session_id=f.session_id AND h.source_type=f.kind AND h.source_id=f.id AND h.action='approve'))-strftime('%s',f.created_at))/3600 AS INTEGER) END,
       coalesce((SELECT min(due_at) FROM business_tasks t WHERE t.session_id=f.session_id AND t.source_type=f.kind AND t.source_id=f.id AND t.status='open'),'')
FROM business_forms f
LEFT JOIN travel_requests tr ON tr.session_id=f.session_id AND tr.form_id=f.id
LEFT JOIN expense_claims e ON e.session_id=f.session_id AND e.form_id=f.id;
CREATE TABLE approval_decisions (
    session_id TEXT NOT NULL, id TEXT NOT NULL, request_id TEXT NOT NULL,
    task_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('approve','return','withdraw')),
    actor_id TEXT NOT NULL, opinion TEXT NOT NULL, business_version INTEGER NOT NULL, decided_at TEXT NOT NULL,
    PRIMARY KEY(session_id,id),
    FOREIGN KEY(session_id,request_id) REFERENCES approval_requests(session_id,id) ON DELETE CASCADE,
    FOREIGN KEY(session_id,task_id) REFERENCES business_tasks(session_id,id) ON DELETE CASCADE
);
