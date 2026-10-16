-- Keep historical people and audit actors, expose two operational accounts.
UPDATE employees SET active=0 WHERE id NOT IN ('EMP-001','EMP-002');
UPDATE employees SET active=1,roles='["employee","workflow-initiator"]' WHERE id='EMP-001';
UPDATE employees SET active=1,roles='["manager","workflow-approver","workflow-analyst"]' WHERE id='EMP-002';
UPDATE approval_requests SET applicant_id='EMP-001',reviewer_id='EMP-002',department_id='DEP-001',business_version=business_version+1
WHERE status<>'approved' AND (applicant_id<>'EMP-001' OR reviewer_id<>'EMP-002' OR department_id<>'DEP-001');
UPDATE business_forms SET applicant_id='EMP-001',reviewer_id='EMP-002',department_id='DEP-001',business_version=business_version+1
WHERE status<>'approved' AND (applicant_id<>'EMP-001' OR reviewer_id<>'EMP-002' OR department_id<>'DEP-001');
UPDATE business_tasks SET assignee_id=CASE
  WHEN source_type='approval' AND EXISTS(SELECT 1 FROM approval_requests a WHERE a.session_id=business_tasks.session_id AND a.id=business_tasks.source_id AND a.status='returned') THEN 'EMP-001'
  ELSE 'EMP-002' END WHERE status='open';
UPDATE demo_sessions SET dataset_version='2026-10-16.2';
