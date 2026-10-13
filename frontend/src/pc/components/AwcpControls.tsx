import { Switch } from 'antd';
import { useContext } from 'react';
import { AwcpSettingsContext, useAwcpSettings } from '../../app/awcpSettingsContext';
import { usePreferences } from '../../common/preferences/context';
import styles from './AwcpControls.module.css';

export function AwcpControls() {
  const service = useContext(AwcpSettingsContext);
  const state = useAwcpSettings();
  const { t } = usePreferences();
  if (!service) return null;
  return (
    <div className={styles.controls}>
      <label title={t('开启时由网站主动提供 AWCP；关闭后可由 Desktop WebView 注入。设置对整个站点生效。')}>
        <span>{t('主动提供 AWCP')}</span>
        <Switch size="small" aria-label={t('主动提供 AWCP')}
          checked={state.settings?.activeEnabled === true}
          disabled={!state.settings || state.loading || state.saving}
          loading={state.loading || state.saving}
          onChange={(enabled) => void service.update(enabled)} />
      </label>
      {state.error && <div className={styles.error} role="alert">
        <span>{t(state.error)}</span>
        <button type="button" disabled={state.saving} onClick={() => void service.refresh()}>{t('重试')}</button>
      </div>}
    </div>
  );
}
