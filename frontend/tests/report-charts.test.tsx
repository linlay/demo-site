import type { DemoApi, ReportFilter, ReportResult } from '@app/api';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { useReportCharts } from '../src/pc/hooks/useReportCharts';

const initial: ReportFilter = {
  dataSource: 'business',
  kind: 'expense',
  from: '',
  to: '',
  departmentId: '',
  scenarioId: '',
  status: '',
  groupBy: 'month',
  page: 1,
  pageSize: 20
};
const response = (filter: ReportFilter, generation = 'g1'): ReportResult => ({
  generation,
  filter,
  items: [],
  summary: { count: 1, amountCents: 100, approved: 1, overdue: 0, averageHours: 1 },
  groups: [{ key: filter.scenarioId || 'all', count: 1, amountCents: 100, approved: 1, overdue: 0, averageHours: 1 }]
});
function Probe({ api, filter }: { api: DemoApi; filter: ReportFilter }) {
  const charts = useReportCharts(api, filter, 'g1');
  return <output>{charts.error || charts.data?.month[0]?.key || 'loading'}</output>;
}
it('uses identical filters for four dimensions, cancels obsolete work and ignores late responses', async () => {
  const deferred: Array<() => void> = [];
  const report = vi.fn((filter: ReportFilter, _signal?: AbortSignal) =>
    filter.scenarioId
      ? Promise.resolve(response(filter))
      : new Promise<ReportResult>((resolve) => deferred.push(() => resolve(response(filter))))
  );
  const api = { report } as unknown as DemoApi;
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Probe api={api} filter={initial} />));
    expect(report).toHaveBeenCalledTimes(4);
    const next = { ...initial, scenarioId: 'O09', from: '2025-01-01', to: '2025-12-31' };
    await act(async () => root.render(<Probe api={api} filter={next} />));
    expect(container.textContent).toBe('O09');
    expect(report.mock.calls[0][1]?.aborted).toBe(true);
    expect(report.mock.calls.slice(4).map(([filter]) => filter.groupBy)).toEqual([
      'month',
      'status',
      'department',
      'scenario'
    ]);
    for (const [filter] of report.mock.calls.slice(4))
      expect(filter).toMatchObject({ dataSource: 'business', kind: 'expense', scenarioId: 'O09', from: '2025-01-01', to: '2025-12-31', pageSize: 1 });
    await act(async () => deferred.forEach((resolve) => resolve()));
    expect(container.textContent).toBe('O09');
    await act(async () => root.render(<Probe api={api} filter={{ ...next, page: 2, groupBy: 'status' }} />));
    expect(report).toHaveBeenCalledTimes(8);
    await act(async()=>root.render(<Probe api={api} filter={{...next,dataSource:'historical-fixtures',kind:''}} />));
    expect(report).toHaveBeenCalledTimes(12);
    for(const [filter] of report.mock.calls.slice(8))expect(filter.dataSource).toBe('historical-fixtures');
  } finally {
    await act(async () => root.unmount());
  }
});
it('rejects aggregates from a different reset generation', async () => {
  const api = { report: vi.fn(async (filter: ReportFilter) => response(filter, 'g2')) } as unknown as DemoApi;
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Probe api={api} filter={initial} />));
    expect(container.textContent).toBe('demo.generation-changed');
  } finally {
    await act(async () => root.unmount());
  }
});
