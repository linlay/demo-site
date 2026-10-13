import { expect, it, vi } from 'vitest';
import type { AwcpSettings } from '@app/api';
import { AwcpSettingsService } from '../src/pc/service/awcpSettingsService';

it('starts without exposure and coalesces simultaneous settings reads', async () => {
  let release: ((value: AwcpSettings) => void) | undefined;
  const read = vi.fn(() => new Promise<AwcpSettings>((resolve) => { release = resolve; }));
  const service = new AwcpSettingsService({ awcpSettings: read, updateAwcpSettings: vi.fn() });
  const first = service.refresh();
  const second = service.refresh();
  expect(read).toHaveBeenCalledTimes(1);
  expect(service.snapshot().settings).toBeUndefined();
  release?.({ activeEnabled: true, version: 2 });
  await Promise.all([first, second]);
  expect(service.snapshot()).toMatchObject({ settings: { activeEnabled: true, version: 2 }, loading: false });
});

it('recovers the saved state after a committed update loses its HTTP response', async () => {
  let saved = { activeEnabled: false, version: 1 };
  const update = vi.fn(async () => { saved = { activeEnabled: true, version: 2 }; throw new TypeError('connection lost'); });
  const service = new AwcpSettingsService({ awcpSettings: async () => saved, updateAwcpSettings: update });
  await service.refresh();
  await service.update(true);
  expect(update).toHaveBeenCalledWith(true, 1);
  expect(service.snapshot()).toMatchObject({ settings: saved, loading: false, saving: false, error: 'connection lost' });
});

it('never re-enables an interface with an old read delivered after disabling it', async () => {
  let release: ((value: AwcpSettings) => void) | undefined;
  const read = vi.fn<() => Promise<AwcpSettings>>().mockResolvedValueOnce({ activeEnabled: true, version: 1 })
    .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const service = new AwcpSettingsService({ awcpSettings: read, updateAwcpSettings: async () => ({ activeEnabled: false, version: 2 }) });
  await service.refresh();
  const stale = service.refresh();
  await service.update(false);
  release?.({ activeEnabled: true, version: 1 });
  await stale;
  expect(service.snapshot().settings).toEqual({ activeEnabled: false, version: 2 });
  read.mockRejectedValueOnce(new TypeError('offline'));
  await service.refresh();
  expect(service.snapshot().settings).toBeUndefined();
  read.mockResolvedValueOnce({ activeEnabled: false, version: 2 });
  await service.refresh();
  expect(service.snapshot().settings?.activeEnabled).toBe(false);
});

it('fails closed on an invalid server response', async () => {
  const service = new AwcpSettingsService({
    awcpSettings: async () => ({ activeEnabled: 'true', version: 1 } as unknown as AwcpSettings),
    updateAwcpSettings: vi.fn()
  });
  await service.refresh();
  expect(service.snapshot().settings).toBeUndefined();
  expect(service.snapshot().error).toContain('响应无效');
});
