export type ScenarioGroup = 'office' | 'securities' | 'protocol';

export interface ScenarioDefinition {
  readonly id: string;
  readonly title: string;
  readonly group: ScenarioGroup;
  readonly technicalFocus: string;
  readonly path: string;
}

export const SCENARIO_GROUPS: ReadonlyArray<{ id: ScenarioGroup; title: string }> = [
  { id: 'office', title: '通用办公' },
  { id: 'securities', title: '业务场景' },
  { id: 'protocol', title: '协议实验' }
];

const definitions: ReadonlyArray<Omit<ScenarioDefinition, 'path'>> = [
  { id: 'O01', title: '工作台与待办', group: 'office', technicalFocus: '聚合查询 · 来源联动' },
  { id: 'O02', title: '人员与组织', group: 'office', technicalFocus: '组织树 · 权限范围' },
  { id: 'O03', title: '公告与通知', group: 'office', technicalFocus: '批量发布 · 阅读回执' },
  { id: 'O04', title: '邮件与内部消息', group: 'office', technicalFocus: '关联对象 · 消息协作' },
  { id: 'O05', title: '日程与会议', group: 'office', technicalFocus: '资源预订 · 冲突校验' },
  { id: 'O06', title: '文档与知识库', group: 'office', technicalFocus: '块编辑 · 版本管理' },
  { id: 'O07', title: '表格与数据处理', group: 'office', technicalFocus: '批量编辑 · 数据校验' },
  { id: 'O08', title: '审批中心', group: 'office', technicalFocus: '审批流转 · 业务幂等' },
  { id: 'O09', title: '差旅与费用', group: 'office', technicalFocus: '主从单据 · 事务一致性' },
  { id: 'O10', title: '人事与考勤', group: 'office', technicalFocus: '动态规则 · 额度校验' },
  { id: 'O11', title: '采购与供应商', group: 'office', technicalFocus: '多对象关联 · 状态流转' },
  { id: 'O12', title: '合同与用印', group: 'office', technicalFocus: '条件校验 · 版本检查' },
  { id: 'O13', title: '资产与行政', group: 'office', technicalFocus: '资源占用 · 状态联动' },
  { id: 'O14', title: '项目与任务协作', group: 'office', technicalFocus: '任务依赖 · 协作进度' },
  { id: 'O15', title: 'IT 服务与权限', group: 'office', technicalFocus: '角色权限 · 服务流转' },
  { id: 'O16', title: '统计报表与档案', group: 'office', technicalFocus: '异步任务 · 结果归档' },
  { id: 'S01', title: '客户资料审核与适当性匹配', group: 'securities', technicalFocus: '动态校验 · 规则联动' },
  { id: 'S02', title: '研报编制、审阅与发布', group: 'securities', technicalFocus: '版本管理 · 多级审核' },
  { id: 'S03', title: '投行立项与尽调协作', group: 'securities', technicalFocus: '多对象协作 · 状态流转' },
  { id: 'S04', title: '风险预警调查与处置', group: 'securities', technicalFocus: '复杂表单 · 条件字段' },
  { id: 'S05', title: '机构客户服务与路演协同', group: 'securities', technicalFocus: '跨场景编排 · 资源冲突' },
  { id: 'P01', title: '两层发现与标准调用', group: 'protocol', technicalFocus: '目录发现 · 标准调用' },
  { id: 'P02', title: 'Schema 与字段错误', group: 'protocol', technicalFocus: '结构校验 · 字段错误' },
  { id: 'P03', title: '只读动态校验', group: 'protocol', technicalFocus: '只读校验 · 业务约束' },
  { id: 'P04', title: 'revision 与合同更新', group: 'protocol', technicalFocus: '合同更新 · revision' },
  { id: 'P05', title: '生命周期与多实例', group: 'protocol', technicalFocus: '注册卸载 · 页面隔离' },
  { id: 'P06', title: '异步取消与迟到结果', group: 'protocol', technicalFocus: '异步取消 · 迟到结果' },
  { id: 'P07', title: '重复请求与业务幂等', group: 'protocol', technicalFocus: '请求去重 · 业务幂等' },
  { id: 'P08', title: '受控错误与异常归一', group: 'protocol', technicalFocus: '受控错误 · 异常归一' },
  { id: 'P09', title: '动态合同与最新状态', group: 'protocol', technicalFocus: '动态 Schema · 最新状态' },
  { id: 'P10', title: '容量与隔离', group: 'protocol', technicalFocus: '容量限制 · 多实例隔离' }
];

export const SCENARIOS: ReadonlyArray<ScenarioDefinition> = definitions.map((definition) => ({
  ...definition,
  path: `/scenes/${definition.id}`
}));

const scenariosById = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));

export function findScenario(id: string): ScenarioDefinition | undefined {
  return scenariosById.get(id);
}
