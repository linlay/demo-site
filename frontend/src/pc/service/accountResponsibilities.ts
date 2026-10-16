import type { DemoState } from '../../common/fixtures/types';

const ROLE_LABELS: Readonly<Record<string, string>> = {
  manager: '审批负责人',
  reviewer: '客户复核',
  analyst: '研究分析',
  quality: '研究质控',
  compliance: '合规审核',
  publisher: '研报发布',
  'ib-manager': '投行项目负责人',
  'ib-member': '投行项目成员',
  'ib-quality': '投行质控',
  'ib-committee': '投行内核',
  hr: '人事管理',
  'it-coordinator': 'IT 协调',
  'it-agent': 'IT 办理',
  'risk-monitor': '风险监控',
  'risk-investigator': '风险调查',
  'risk-reviewer': '风险复核',
  'institution-sales': '机构销售',
  'research-service': '机构研究',
  'event-organizer': '路演组织'
};

const SCENE_DUTIES: Readonly<Record<string, readonly string[]>> = {
  S01: ['客户经理', '客户复核'],
  S02: ['研究分析', '研究质控', '合规审核', '研报发布'],
  S03: ['投行项目负责人', '投行项目成员', '投行质控', '投行内核'],
  S04: ['风险监控', '风险调查', '风险复核'],
  S05: ['机构销售', '机构研究', '路演组织']
};

/** Display the server duties together with roles from the remaining browser domains. */
export function accountResponsibilities(
  employee: { id: string; roles: readonly string[] },
  state?: DemoState,
  sceneId?: string
): string[] {
  if (employee.roles.includes('workflow-initiator')) return ['发起与办理', '各类业务 · 本人负责事项'];
  if (employee.roles.includes('workflow-approver')) return ['审核', '各类业务 · 分派给本人的单据'];
  if (employee.roles.includes('workflow-analyst')) return ['数据分析', '查看全局统计与业务明细'];
  const roles = new Set([...employee.roles, ...(state?.employees.find((item) => item.id === employee.id)?.roles ?? [])]);
  const labels = state?.clients.some((client) => client.managerId === employee.id) ? ['客户经理'] : [];
  for (const role of roles) {
    if (ROLE_LABELS[role]) labels.push(ROLE_LABELS[role]);
  }
  const relevant = sceneId && SCENE_DUTIES[sceneId] ? labels.filter((label) => SCENE_DUTIES[sceneId].includes(label)) : labels;
  return relevant.length ? relevant : ['业务经办'];
}
