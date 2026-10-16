import { DemoApi, type Approval, type BusinessPage, type DemoSession } from '@app/api';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { DemoSessionContext } from '../src/app/demoSessionContext';
import { AppProviders } from '../src/app/AppProviders';
import ServerBusinessPage from '../src/pc/pages/ServerBusinessPage';
import { BusinessService } from '../src/pc/service/businessService';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';
import { siteForRoute } from '../src/common/awcp/site';

const session: DemoSession = {
  id: 'workspace',
  generation: 'g1',
  seed: 1,
  datasetVersion: 'test',
  profile: 'acceptance',
  simulatedAt: '2026-09-20T01:00:00Z',
  expiresAt: '2090-01-01T00:00:00Z',
  recordCount: 48,
  employees: [
    { id: 'EMP-001', departmentId: 'DEP-001', name: '虚构申请人', roles: ['employee'], active: true },
    { id: 'EMP-002', departmentId: 'DEP-001', name: '虚构主管', roles: ['employee', 'manager'], active: true }
  ],
  departments: [{ id: 'DEP-001', name: '虚构部门' }]
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

it('adapts legacy approval and expense action contracts and validates through the read-only endpoint', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
    json({
      id: 'APPR-004',
      status: 'submitted',
      businessVersion: 1,
      taskId: 'TODO-002',
      generation: 'g1',
      revision: 1
    })
  );
  const api = new DemoApi(fetcher);
  api.adoptSession(session);
  const service = new BusinessService(api);
  const args = {
    requestId: null,
    actorId: 'EMP-001',
    expectedVersion: null,
    title: '虚构申请',
    description: '演示',
    materialIds: ['APMAT-001'],
    idempotencyKey: 'stable-key'
  };
  expect(await service.action('office.approval.submit', args)).toEqual({
    requestId: 'APPR-004',
    taskId: 'TODO-002',
    status: 'submitted',
    businessVersion: 1
  });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
    requestId: null,
    expectedVersion: 0,
    idempotencyKey: 'stable-key',
    expectedGeneration: 'g1'
  });
  await service.action('office.approval.submit', args, undefined, true);
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/business/approval_submit/validate');
  await service.action('office.expense.review', {
    expenseFormId: 'FORM-003',
    actorId: 'EMP-002',
    expectedVersion: 2,
    idempotencyKey: 'review',
    decision: 'approve',
    reason: ''
  });
  expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toMatchObject({ id: 'FORM-003', opinion: '同意' });
  fetcher.mockImplementation(async () =>
    json({
      items: [
        {
          id: 'TODO-001',
          title: '差旅待办',
          assigneeId: 'EMP-002',
          sourceType: 'travel',
          sourceId: 'FORM-001',
          dueAt: '2000-01-01T00:00:00Z',
          sourceVersion: 1,
          sourceStatus: 'submitted'
        },
        {
          id: 'TODO-002',
          title: '未来待办',
          assigneeId: 'EMP-002',
          sourceType: 'travel',
          sourceId: 'FORM-003',
          dueAt: '2100-01-01T00:00:00Z',
          sourceVersion: 1,
          sourceStatus: 'submitted'
        },
        {
          id: 'TODO-003',
          title: '报销待办',
          assigneeId: 'EMP-002',
          sourceType: 'expense',
          sourceId: 'FORM-004',
          dueAt: '2000-01-01T00:00:00Z',
          sourceVersion: 2,
          sourceStatus: 'submitted'
        }
      ]
    })
  );
  expect(await service.action('office.todo.query', { actorId: 'EMP-002' })).toMatchObject({
    items: [
      { todoId: 'TODO-001', sourceType: 'form', canComplete: true },
      { todoId: 'TODO-003', sourceType: 'form', canComplete: false }
    ]
  });
  api.blockStaleSession();
  await expect(service.call('approval_submit', args)).rejects.toMatchObject({ status: 409 });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('loads server approval rows in StrictMode and exposes only the active page Actions', async () => {
  const approval: Approval = {
    id: 'APPR-001',
    title: '服务端申请',
    description: '来自SQLite',
    applicantId: 'EMP-001',
    reviewerId: 'EMP-002',
    departmentId: 'DEP-001',
    materialIds: ['APMAT-001'],
    status: 'submitted',
    businessVersion: 1,
    currentTaskId: 'APPTODO-001',
    createdAt: '2026-09-20T01:00:00Z'
  };
  const page: BusinessPage<Approval> = {
    items: [approval],
    total: 1,
    page: 1,
    pageSize: 20,
    generation: 'g1',
    revision: 0
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).includes('approval_center_query')
        ? json({ ...page, items: page.items.map((item) => ({ ...item, kind: 'approval' })) })
        : String(url).includes('approval_templates_list') || String(url).includes('approval_materials_list')
          ? json([])
          : json({ valid: true, fieldErrors: [] })
    );
  const api = new DemoApi(fetcher);
  api.adoptSession(session);
  const route = resolveRoute('/scenes/O08');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const previous = window.location.href;
  window.history.replaceState(null, '', '/scenes/O08');
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <DemoSessionContext.Provider
            value={{ session, api, reset: async () => undefined, refresh: async () => undefined }}
          >
            <AppProviders exposeAwcp site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
              <ServerBusinessPage scene="O08" navigate={() => undefined} />
            </AppProviders>
          </DemoSessionContext.Provider>
        </StrictMode>
      )
    );
    expect(container.textContent).toContain('服务端申请');
    expect(container.textContent).toContain('共 1 条记录');
    const manual = window.awcp?.manual();
    if (!manual || !('sections' in manual)) throw new Error('manual missing');
    expect(manual.sections.map((section) => section.section).sort()).toEqual([
      'office.approval.approve',
      'office.approval.read',
      'office.approval.return',
      'office.approval.submit',
      'office.approval.withdraw'
    ]);
    expect(fetcher.mock.calls.every((call) => String(call[0]).includes('/api/v1/business/'))).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState(null, '', previous);
  }
});

it('offers typed request choices and submits their fields with the selected reviewer', async () => {
  const templates = [
    {
      id: 'risk',
      name: '风险处置审批',
      category: '风险监控',
      description: '提交风险事项',
      fields: [
        { id: 'riskObject', label: '监控对象', type: 'text' },
        { id: 'riskLevel', label: '风险等级', type: 'select', options: ['低', '中', '高'] }
      ]
    },
    { id: 'investment', name: '投行项目立项', category: '投行项目', description: '提交项目', fields: [] },
    { id: 'institution', name: '机构服务申请', category: '机构服务', description: '提交服务', fields: [] },
    { id: 'suitability', name: '客户适当性审核', category: '客户适当性', description: '提交审核', fields: [] }
  ];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const op = String(url);
    if (op.includes('approval_templates_list')) return json(templates);
    if (op.includes('approval_materials_list')) return json([{ id: 'APMAT-001', name: '业务事项说明' }]);
    if (op.includes('approval_submit'))
      return json({
        id: 'APPR-010',
        status: 'submitted',
        businessVersion: 1,
        taskId: 'TODO-010',
        generation: 'g1',
        revision: 1
      });
    return json({ items: [], total: 0, page: 1, pageSize: 20, generation: 'g1', revision: 0 });
  });
  const api = new DemoApi(fetcher);
  api.adoptSession(session);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const navigate = vi.fn();
  const render = (formType: string) =>
    root.render(
      <DemoSessionContext.Provider
        value={{ session, api, reset: async () => undefined, refresh: async () => undefined }}
      >
        <AppProviders site={siteForRoute(resolveRoute('/scenes/O08/new/risk'))} scopeKey="test.approval.new">
          <ServerBusinessPage scene="O08" formType={formType} navigate={navigate} />
        </AppProviders>
      </DemoSessionContext.Provider>
    );
  try {
    await act(async () => render('default'));
    for (const name of ['风险处置审批', '投行项目立项', '机构服务申请', '客户适当性审核'])
      expect(container.textContent).toContain(name);
    expect(container.textContent).not.toContain('数据分析');
    const risk = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('风险处置审批')
    );
    if (!risk) throw new Error('Missing request choice');
    await act(async () => risk.click());
    expect(navigate).toHaveBeenCalledWith('/scenes/O08/new/risk');
    await act(async () => render('risk'));
    const change = async (label: string, value: string) => {
      const control = [...container.querySelectorAll('label')]
        .find((element) => element.textContent?.trim().startsWith(label))
        ?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea');
      if (!control) throw new Error(`Missing ${label}`);
      await act(async () => {
        control.value = value;
        Simulate.change(control);
      });
    };
    await change('监控对象', '华辰科技');
    await change('风险等级', '高');
    await change('标题', '持仓限额处置');
    await change('申请说明', '请审核处置方案');
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error('Missing material');
    await act(async () => {
      checkbox.checked = true;
      Simulate.change(checkbox);
    });
    const form = container.querySelector('form');
    if (!form) throw new Error('Missing request form');
    await act(async () => Simulate.submit(form));
    const call = fetcher.mock.calls.find(([url]) => String(url).includes('approval_submit'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      templateId: 'risk',
      fields: { riskObject: '华辰科技', riskLevel: '高' },
      reviewerId: 'EMP-002',
      materialIds: ['APMAT-001'],
      actorId: 'EMP-001'
    });
    expect(navigate).toHaveBeenLastCalledWith('/scenes/O08/objects/APPR-010');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
