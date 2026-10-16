UPDATE approval_requests SET template_id='procurement',fields='{"itemName":"办公耗材及打印设备","quantity":"5","budget":"6800"}' WHERE id='APPR-001' AND title IN ('办公用品申请','客户服务部办公用品采购') AND template_id='office';
UPDATE approval_requests SET title='客户服务部办公用品采购' WHERE id='APPR-001' AND title='办公用品申请';
UPDATE approval_requests SET title='季度调研资料申请' WHERE id='APPR-002' AND title='资料补正申请';
UPDATE approval_requests SET title='华辰科技保密协议用印',template_id='seal',fields='{"contractName":"华辰科技保密协议","counterparty":"华辰科技股份有限公司","contractAmount":"10000","sealType":"合同专用章"}' WHERE id='APPR-003' AND title IN ('已批准申请','华辰科技保密协议用印') AND template_id='office';
UPDATE demo_sessions SET dataset_version='2026-10-15.1';
