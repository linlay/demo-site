import type { AwcpSettings, DemoApi } from '@app/api';

export interface AwcpSettingsState {
  settings?: AwcpSettings;
  loading: boolean;
  saving: boolean;
  error: string;
}

export class AwcpSettingsService {
  private state: AwcpSettingsState = { loading: true, saving: false, error: '' };
  private readonly listeners = new Set<() => void>();
  private load?: Promise<void>;
  private mutation = 0;
  private version = 0;

  constructor(private readonly api: Pick<DemoApi, 'awcpSettings' | 'updateAwcpSettings'>) {}
  snapshot = (): AwcpSettingsState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: AwcpSettingsState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  private validate(value: AwcpSettings): void {
    if (!value || typeof value.activeEnabled !== 'boolean' || !Number.isSafeInteger(value.version) || value.version < 1)
      throw new Error('AWCP 设置响应无效，请重试。');
  }
  refresh(message = ''): Promise<void> {
    if (this.load) return this.load;
    const mutation = this.mutation;
    const task = this.api.awcpSettings().then((settings) => {
      this.validate(settings);
      if (mutation !== this.mutation || settings.version < this.version) return;
      this.version = settings.version;
      this.publish({ ...this.state, settings, loading: false, error: message });
    }).catch((error: unknown) => {
      if (mutation !== this.mutation) return;
      this.publish({ ...this.state, settings: undefined, loading: false,
        error: error instanceof Error ? error.message : '无法读取 AWCP 设置，请重试。' });
    }).finally(() => { if (this.load === task) this.load = undefined; });
    this.load = task;
    return task;
  }
  async update(activeEnabled: boolean): Promise<void> {
    const settings = this.state.settings;
    if (!settings || this.state.saving || settings.activeEnabled === activeEnabled) return;
    this.mutation++;
    this.publish({ ...this.state, saving: true, error: '' });
    try {
      const next = await this.api.updateAwcpSettings(activeEnabled, settings.version);
      this.validate(next);
      if (next.version >= this.version) {
        this.version = next.version;
        this.publish({ settings: next, loading: false, saving: false, error: '' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法保存 AWCP 设置，请重试。';
      // A lost response may follow a committed write. Re-read the authoritative state.
      this.publish({ settings: undefined, loading: true, saving: true, error: message });
      if (this.load) await this.load;
      await this.refresh(message);
    } finally {
      if (this.state.saving) this.publish({ ...this.state, saving: false });
    }
  }
}
