-- Coarse workflow duties; historical identities remain available to audit views.
UPDATE employees SET active=CASE WHEN id IN ('EMP-001','EMP-002','EMP-003','EMP-004','EMP-005','EMP-006') THEN 1 ELSE 0 END;
UPDATE employees SET roles='["employee","workflow-initiator"]' WHERE id IN ('EMP-001','EMP-003','EMP-005');
UPDATE employees SET roles='["manager","workflow-approver"]' WHERE id IN ('EMP-002','EMP-004');
UPDATE employees SET roles='["workflow-analyst"]' WHERE id='EMP-006';
CREATE TABLE workflow_samples_initialized (
    session_id TEXT PRIMARY KEY REFERENCES demo_sessions(id) ON DELETE CASCADE
);
UPDATE demo_sessions SET dataset_version='2026-10-16.3';
