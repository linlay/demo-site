package repository

// Historical employees and actors remain addressable for audit display.
func (b *BusinessTx) seedTwoAccountWorkflow() error {
	for _, query := range []string{
		`UPDATE approval_requests SET applicant_id='EMP-001',reviewer_id='EMP-002',department_id='DEP-001' WHERE session_id=?`,
		`UPDATE business_forms SET applicant_id='EMP-001',reviewer_id='EMP-002',department_id='DEP-001' WHERE session_id=?`,
		`UPDATE business_tasks SET assignee_id=CASE WHEN status='open' AND source_type='approval' AND EXISTS(SELECT 1 FROM approval_requests a WHERE a.session_id=business_tasks.session_id AND a.id=business_tasks.source_id AND a.status='returned') THEN 'EMP-001' ELSE 'EMP-002' END WHERE session_id=?`,
	} {
		if err := b.Exec(query, b.Session.ID); err != nil {
			return err
		}
	}
	return nil
}
