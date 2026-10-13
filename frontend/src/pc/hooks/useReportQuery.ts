import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DemoApi, ReportFilter, ReportResult } from '@app/api';
import { useRealtime } from '../../app/realtimeContext';

export function useReportQuery(api: DemoApi) {
  const realtime = useRealtime();
  const observerId = useId();
  const [result, setResult] = useState<ReportResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef<AbortController>();
  const inFlight = useRef<Promise<ReportResult>>();
  const lastFilter = useRef<ReportFilter>();
  const appliedRevision = useRef(0);
  const query = useCallback(
    (filter: ReportFilter, signal?: AbortSignal): Promise<ReportResult> => {
      latest.current?.abort();
      const controller = new AbortController();
      latest.current = controller;
      lastFilter.current = { ...filter };
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      setLoading(true);
      setError('');
      const pending = (async () => {
        try {
          const next = await api.report(filter, controller.signal);
          if (controller.signal.aborted || latest.current !== controller)
            throw new DOMException('请求已取消。', 'AbortError');
          appliedRevision.current = next.revision ?? 0;
          realtime?.acknowledge(observerId, appliedRevision.current);
          setResult(next);
          return next;
        } catch (failure) {
          if (latest.current === controller && !controller.signal.aborted)
            setError(failure instanceof Error ? failure.message : '查询失败，请重试。');
          throw failure;
        } finally {
          signal?.removeEventListener('abort', abort);
          if (latest.current === controller) {
            inFlight.current = undefined;
            setLoading(false);
          }
        }
      })();
      inFlight.current = pending;
      return pending;
    },
    [api, observerId, realtime]
  );
  useEffect(
    () =>
      realtime?.observe(observerId, {
        resources: ['reports', 'business-analysis'],
        revision: appliedRevision.current,
        refresh: async () => {
          const next = inFlight.current
            ? await inFlight.current
            : lastFilter.current
              ? await query(lastFilter.current)
              : undefined;
          return next?.revision ?? appliedRevision.current;
        }
      }),
    [observerId, query, realtime]
  );
  useEffect(
    () => () => {
      latest.current?.abort();
      latest.current = undefined;
    },
    []
  );
  return { result, loading, error, query };
}
