import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactElement
} from 'react';
import { Modal } from 'antd';
import { DemoApi, observeWorkspace, type DemoSession } from '@app/api';
import { usePreferences } from '../common/preferences/context';
import { RealtimeService, type SyncMode } from '../pc/service/realtimeService';
import { DemoSessionContext } from './demoSessionContext';
import { RealtimeContext } from './realtimeContext';
import styles from './DemoSessionBoundary.module.css';

function initialMode(): SyncMode {
  try {
    const mode = sessionStorage.getItem('awcp:realtime-mode');
    if (mode === 'off' || mode === 'auto') return mode;
  } catch {
    /* optional persistence */
  }
  return 'notify';
}

export function DemoSessionBoundary({ children }: PropsWithChildren): ReactElement {
  const { t } = usePreferences();
  const [api] = useState(() => new DemoApi());
  const [realtime] = useState(() => new RealtimeService(initialMode()));
  const sync = useSyncExternalStore(realtime.subscribe, realtime.snapshot);
  const [session, setSession] = useState<DemoSession>();
  const current = useRef<DemoSession>();
  const [pendingSession, setPendingSession] = useState<DemoSession>();
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [streamAttempt, setStreamAttempt] = useState(0);
  const cursor = useRef('');
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const resetInFlight = useRef(false);
  const checkAfterReset = useRef(false);

  const adopt = useCallback(
    (next: DemoSession) => {
      const previous = current.current;
      const changed = previous?.id !== next.id || previous.generation !== next.generation;
      api.adoptSession(next);
      current.current = next;
      if (changed) {
        cursor.current = next.eventCursor ?? '';
        realtime.reset();
      }
      realtime.setPaused(false);
      setSession(next);
      setPendingSession(undefined);
      setError('');
    },
    [api, realtime]
  );

  const refresh = useCallback(async () => {
    if (resetInFlight.current) {
      checkAfterReset.current = true;
      return;
    }
    try {
      const next = await api.session(false);
      if (!mounted.current || resetInFlight.current) return;
      const previous = current.current;
      if (previous && (previous.id !== next.id || previous.generation !== next.generation)) {
        // Keep mounted editors and their drafts until the user explicitly accepts.
        api.blockStaleSession();
        realtime.setPaused(true);
        setPendingSession(next);
        setError('');
      } else {
        if (previous && (next.revision ?? 0) > (previous.revision ?? 0))
          realtime.receive({
            id: next.eventCursor ?? '',
            workspaceId: next.id,
            generation: next.generation,
            revision: next.revision ?? 0,
            type: 'sync.required',
            source: 'server',
            resources: ['reports', 'directory', 'session']
          });
        adopt(next);
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : '无法连接演示服务。');
    }
  }, [adopt, api, realtime]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onVisible = () => {
      const visible = document.visibilityState === 'visible';
      realtime.setVisible(visible);
      if (visible) {
        void refresh();
        setStreamAttempt((attempt) => attempt + 1);
      }
    };
    realtime.setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      mounted.current = false;
      realtime.dispose();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [realtime, refresh]);

  useEffect(() => {
    try {
      sessionStorage.setItem('awcp:realtime-mode', sync.mode);
    } catch {
      /* optional persistence */
    }
  }, [sync.mode]);

  const workspaceKey = session ? `${session.id}:${session.generation}` : '';
  useEffect(() => {
    realtime.setConnected(false);
    if (!workspaceKey || sync.mode === 'off' || typeof EventSource === 'undefined' || pendingSession) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const close = observeWorkspace(cursor.current, {
      status: (connected) => realtime.setConnected(connected),
      invalid: () => {
        api.blockStaleSession();
        realtime.setPaused(true);
        void refresh();
        retry = setTimeout(() => setStreamAttempt((attempt) => attempt + 1), 3000);
      },
      change: (event) => {
        const view = current.current;
        if (!view) return;
        cursor.current = event.id;
        if (resetInFlight.current) {
          if (!api.ownsOperation(event.operationId)) checkAfterReset.current = true;
          return;
        }
        if (event.workspaceId !== view.id || event.generation !== view.generation) {
          api.blockStaleSession();
          realtime.setPaused(true);
          void refresh();
          return;
        }
        realtime.receive(event);
      }
    });
    return () => {
      close();
      if (retry) clearTimeout(retry);
    };
  }, [api, pendingSession, realtime, refresh, streamAttempt, sync.mode, workspaceKey]);

  const reset = useCallback(async () => {
    if (resetInFlight.current) return;
    resetInFlight.current = true;
    realtime.setPaused(true);
    setResetting(true);
    setError('');
    try {
      const next = await api.reset();
      if (!mounted.current) return;
      window.history.replaceState(null, '', '/scenes/O01');
      window.dispatchEvent(new PopStateEvent('popstate'));
      adopt(next);
      setNotice('演示数据已恢复初始状态，可以重新办理。');
    } catch (failure) {
      checkAfterReset.current = true;
      if (mounted.current) setError(failure instanceof Error ? failure.message : t('重置失败，请重试。'));
      throw failure;
    } finally {
      resetInFlight.current = false;
      realtime.setPaused(false);
      if (mounted.current) setResetting(false);
      if (checkAfterReset.current) {
        checkAfterReset.current = false;
        void refresh();
      }
    }
  }, [adopt, api, realtime, refresh, t]);

  if (!session)
    return (
      <main className={styles.screen}>
        <h1>demo-site</h1>
        <p role={error ? 'alert' : 'status'}>{error || t('正在准备独立的演示数据…')}</p>
        {error && (
          <button type="button" onClick={() => void refresh()}>
            {t('重新连接')}
          </button>
        )}
      </main>
    );

  return (
    <DemoSessionContext.Provider value={{ session, api, reset, refresh }}>
      <RealtimeContext.Provider value={realtime}>
        {notice && (
          <div className={styles.notice} role="status">
            {t(notice)}
            <button type="button" aria-label={t('关闭提示')} onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {error && (
          <div className={styles.error} role="alert">
            {error}
            <button type="button" onClick={() => void refresh()}>
              {t('刷新会话')}
            </button>
          </div>
        )}
        {pendingSession && (
          <div className={styles.error} role="alert">
            {t('演示空间已更新。当前输入已保留，旧数据暂不可提交。')}
            <button type="button" onClick={() => setConfirming(true)}>
              {t('载入最新数据')}
            </button>
          </div>
        )}
        <Modal
          open={confirming}
          title={t('载入最新数据？')}
          okText={t('确认载入')}
          cancelText={t('继续查看当前输入')}
          confirmLoading={applying}
          onCancel={() => {
            if (!applying) setConfirming(false);
          }}
          onOk={() => {
            if (applying) return;
            setApplying(true);
            void api
              .session(false)
              .then((next) => {
                if (mounted.current) {
                  adopt(next);
                  setConfirming(false);
                }
              })
              .catch((failure: unknown) => {
                if (mounted.current) setError(failure instanceof Error ? failure.message : t('无法连接演示服务。'));
              })
              .finally(() => {
                if (mounted.current) setApplying(false);
              });
          }}
        >
          <p>{t('载入后当前页面会重新初始化，请先复制需要保留的未保存内容。')}</p>
        </Modal>
        {resetting ? (
          <main className={styles.screen} role="status">
            {t('正在恢复初始数据，请稍候…')}
          </main>
        ) : (
          <Fragment key={workspaceKey}>{children}</Fragment>
        )}
      </RealtimeContext.Provider>
    </DemoSessionContext.Provider>
  );
}
