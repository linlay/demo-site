ALTER TABLE approval_requests ADD COLUMN template_id TEXT NOT NULL DEFAULT 'office';
ALTER TABLE approval_requests ADD COLUMN fields TEXT NOT NULL DEFAULT '{}';

-- Retain historical references while removing load-test identities from operators.
UPDATE employees SET active=0 WHERE id > 'EMP-010';
UPDATE employees SET name=CASE id
  WHEN 'EMP-001' THEN '林悦' WHEN 'EMP-002' THEN '陈明'
  WHEN 'EMP-003' THEN '王晨' WHEN 'EMP-004' THEN '赵敏'
  WHEN 'EMP-005' THEN '刘洋' WHEN 'EMP-006' THEN '周宁'
  WHEN 'EMP-007' THEN '徐嘉' WHEN 'EMP-008' THEN '张远'
  WHEN 'EMP-009' THEN '李桐' WHEN 'EMP-010' THEN '孙岚' ELSE name END;
UPDATE employees SET roles=json_insert(roles,'$[#]','manager') WHERE id IN ('EMP-004','EMP-005') AND NOT EXISTS(SELECT 1 FROM json_each(roles) WHERE value='manager');
UPDATE employees SET roles=json_insert(roles,'$[#]','ib-committee') WHERE id='EMP-004' AND NOT EXISTS(SELECT 1 FROM json_each(roles) WHERE value='ib-committee');
UPDATE employees SET roles=json_insert(roles,'$[#]','employee') WHERE id <= 'EMP-010' AND NOT EXISTS(SELECT 1 FROM json_each(roles) WHERE value='employee');
UPDATE approval_requests SET title=replace(replace(title,'虚构',''),'演示',''),description=replace(replace(description,'用于演示的申请说明。','请审核申请事项及相关材料。'),'虚构','');
UPDATE approval_materials SET name=CASE id WHEN 'APMAT-001' THEN '业务事项说明' WHEN 'APMAT-002' THEN '补充说明及核查材料' ELSE name END;
UPDATE business_tasks SET title=replace(replace(title,'虚构',''),'演示','');
UPDATE business_assets SET filename=replace(filename,'演示','');

-- Seed the four securities request types into existing initialized workspaces.
INSERT INTO approval_requests(session_id,id,applicant_id,department_id,reviewer_id,title,description,status,business_version,current_task_id,created_at,template_id,fields)
SELECT i.session_id, x.id,'EMP-001','DEP-001','EMP-002',x.title,x.description,'submitted',1,x.task,s.simulated_at,x.template,x.fields
FROM business_initialized i JOIN demo_sessions s ON s.id=i.session_id CROSS JOIN (
 SELECT 'APPR-900001' AS id,'APPTODO-900001' AS task,'risk' AS template,'华辰科技持仓集中度超限处置' AS title,'持仓集中度触及预警线，建议分三日降低敞口并持续监测。' AS description,'{"riskObject":"华辰科技持仓组合","riskLevel":"高","discoveredOn":"2026-09-18","disposition":"分批降低持仓并每日复核风险指标"}' AS fields
 UNION ALL SELECT 'APPR-900002','APPTODO-900002','investment','远航新材公司债项目立项','拟承做远航新材公司债发行，已完成初步客户准入核查。','{"projectName":"远航新材公司债","clientName":"远航新材料股份有限公司","projectType":"债券发行","financingAmount":"50000"}'
 UNION ALL SELECT 'APPR-900003','APPTODO-900003','institution','汇安资产四季度策略路演','拟安排宏观与行业研究团队为客户开展四季度策略交流。','{"institutionName":"汇安资产管理有限公司","serviceType":"研究路演","serviceDate":"2026-10-20","serviceContent":"四季度宏观展望及先进制造行业交流"}'
 UNION ALL SELECT 'APPR-900004','APPTODO-900004','suitability','嘉和实业债券产品适当性复核','已收集客户风险测评与产品风险说明，请复核匹配结果。','{"clientName":"嘉和实业有限公司","riskRating":"C3 平衡型","productName":"稳盈中短债集合资产管理计划","matchResult":"匹配"}'
) x;
INSERT INTO business_tasks(session_id,id,title,assignee_id,source_type,source_id,due_at,status)
SELECT session_id,current_task_id,title,reviewer_id,'approval',id,created_at,'open' FROM approval_requests WHERE id IN ('APPR-900001','APPR-900002','APPR-900003','APPR-900004');

INSERT INTO approval_request_materials(session_id,request_id,material_id,position)
SELECT session_id,id,'APMAT-001',0 FROM approval_requests WHERE id IN ('APPR-900001','APPR-900002','APPR-900003','APPR-900004');
