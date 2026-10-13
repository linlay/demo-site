import { useEffect, useState } from 'react';
import type { DemoApi, ReportFilter, ReportResult } from '@app/api';

type Groups = ReportResult['groups'];
export type ChartGroups = Record<ReportFilter['groupBy'], Groups>;
const dimensions = ['month', 'status', 'department', 'scenario'] as const;

export function useReportCharts(api: DemoApi, filter: ReportFilter, generation: string, revision = 0) {
  // Paging and the detail table's grouping do not change these four aggregates.
  const key = JSON.stringify({
    dataSource: filter.dataSource,
    kind: filter.kind,
    from: filter.from,
    to: filter.to,
    departmentId: filter.departmentId,
    scenarioId: filter.scenarioId,
    status: filter.status,
    generation,
    revision
  });
  const [state, setState] = useState<{ key: string; data?: ChartGroups; error?: string }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const { generation: expectedGeneration, revision: _revision, ...conditions } = JSON.parse(key) as Omit<
      ReportFilter,
      'groupBy' | 'page' | 'pageSize'
    > & { generation: string; revision: number };
    setState({ key });
    void Promise.all(
      dimensions.map(async (groupBy) => {
        const result = await api.report({ ...conditions, groupBy, page: 1, pageSize: 1 }, controller.signal);
        if (result.generation !== expectedGeneration) throw new Error('demo.generation-changed');
        return [groupBy, result.groups] as const;
      })
    )
      .then((entries) => {
        if (!controller.signal.aborted) setState({ key, data: Object.fromEntries(entries) as ChartGroups });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ key, error: error instanceof Error ? error.message : 'Chart query failed' });
      });
    return () => controller.abort();
  }, [api, key, retry]);
  const current = state?.key === key ? state : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !current?.data && !current?.error,
    retry: () => setRetry((n) => n + 1)
  };
}
