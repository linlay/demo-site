import type { BusinessOperation } from './business';
import type { ApiFailure, AwcpSettings, DemoSession, ReportFilter, ReportResult } from './types';

export class ApiError extends Error {
  constructor(readonly status: number, readonly failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiError';
  }
}

function isFailure(value: unknown): value is ApiFailure {
  return !!value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' &&
    'message' in value && typeof value.message === 'string';
}

export class DemoApi {
  private generation = '';
  private sessionRequest: Promise<DemoSession> | undefined;
  private resetAttempt: { generation: string; requestId: string } | undefined;
  private readonly pending = new Set<AbortController>();
  private blocked = false;
  private workspace = '';

  blockStaleSession(): void { this.blocked = true; this.cancelPending(); }
  canWriteSession(id: string, generation: string): boolean { return !this.blocked && this.workspace === id && this.generation === generation; }
  ownsOperation(id: string | undefined): boolean { return !!id && id === this.resetAttempt?.requestId; }

  constructor(private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args)) {}

  adoptSession(session: DemoSession): void {
    if (this.generation && (this.generation !== session.generation || this.workspace !== session.id)) this.cancelPending();
    this.generation = session.generation;
    this.workspace = session.id;
    this.blocked = false;
    if (this.resetAttempt && this.resetAttempt.generation !== session.generation) this.resetAttempt = undefined;
  }

  cancelPending(): void {
    for (const controller of this.pending) controller.abort();
  }

  session(adopt = true): Promise<DemoSession> {
    // StrictMode and concurrent consumers must not create separate initial sessions/cookies.
    if (!this.sessionRequest) {
      this.sessionRequest = this.request<DemoSession>('/session', 'GET')
        .finally(() => { this.sessionRequest = undefined; });
    }
    return this.sessionRequest.then((session) => { if (adopt) this.adoptSession(session); return session; });
  }

  awcpSettings(): Promise<AwcpSettings> {
    return this.request<AwcpSettings>('/settings/awcp', 'GET', undefined, undefined, '');
  }

  updateAwcpSettings(activeEnabled: boolean, expectedVersion: number): Promise<AwcpSettings> {
    if (this.blocked) return Promise.reject(new ApiError(409, { code: 'session.generation-conflict', message: '演示空间已变化，请先载入最新数据。' }));
    return this.request<AwcpSettings>('/settings/awcp', 'POST', { activeEnabled, expectedVersion });
  }

  async reset(): Promise<DemoSession> {
    if (this.blocked) throw new ApiError(409, { code: 'session.generation-conflict', message: '演示空间已变化，请先载入最新数据。' });
    if (!this.resetAttempt) this.resetAttempt = { generation: this.generation, requestId: crypto.randomUUID() };
    const attempt = this.resetAttempt;
    this.cancelPending();
    // Keep the same key after uncertain network failure: the server may have committed.
    const session = await this.request<DemoSession>('/session/reset', 'POST',
      { requestId: attempt.requestId }, undefined, attempt.generation);
    this.resetAttempt = undefined;
    this.adoptSession(session);
    return session;
  }

  report(filter: ReportFilter, signal?: AbortSignal): Promise<ReportResult> {
    if (this.blocked) return Promise.reject(new ApiError(409, { code: 'session.generation-conflict', message: '演示空间已变化，请先载入最新数据。' }));
    return this.request<ReportResult>('/reports/query', 'POST', filter, signal);
  }

  business<T>(operation: BusinessOperation, input: object, signal?: AbortSignal, validate = false): Promise<T> {
    if (this.blocked) return Promise.reject(new ApiError(409, { code: 'session.generation-conflict', message: '演示空间已变化，请先载入最新数据。' }));
    return this.request<T>(`/business/${operation}${validate ? '/validate' : ''}`, 'POST', { ...input, expectedGeneration: this.generation }, signal);
  }

  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown, signal?: AbortSignal, generation = this.generation): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    this.pending.add(controller);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    try {
      const response = await this.fetcher(`/api/v1${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(generation ? { 'X-Demo-Generation': generation } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const data: unknown = await response.json();
      if (!response.ok) throw new ApiError(response.status, isFailure(data) ? data : { code: 'server.invalid-response', message: '服务响应格式不正确。' });
      // A transport that cannot cancel must still never deliver an old generation's result.
      if (controller.signal.aborted) throw new DOMException('请求已取消。', 'AbortError');
      if (path !== '/session' && path !== '/session/reset' && !(path === '/settings/awcp' && method === 'GET') && generation !== this.generation) {
        throw new ApiError(409, { code: 'session.generation-conflict', message: '演示数据已重置，请重新查询。' });
      }
      return data as T;
    } catch (error) {
      if (timedOut) throw new ApiError(504, { code: 'request.timeout', message: '请求超时，请重试。' });
      throw error;
    } finally {
      clearTimeout(timeout);
      this.pending.delete(controller);
      signal?.removeEventListener('abort', abort);
    }
  }
}
