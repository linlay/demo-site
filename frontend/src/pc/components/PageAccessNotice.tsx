import { useCurrentUser } from '../../app/currentUserContext';
import { usePreferences } from '../../common/preferences/context';
import styles from './PageAccessNotice.module.css';

export interface PageUserChoice {
  id: string;
  name: string;
  responsibilities: string[];
}

export function PageAccessNotice({
  message,
  users = [],
  navigate
}: {
  message: string;
  users?: PageUserChoice[];
  navigate(path: string): void;
}) {
  const identity = useCurrentUser();
  const { t } = usePreferences();
  return (
    <section role="alert" className={styles.notice}>
      <h2>{t('当前用户无法查看此页面')}</h2>
      <p>{message}</p>
      {users.length > 0 && identity ? (
        <>
          <p>{t('可查看此事项的用户：')}</p>
          <div className={styles.choices}>
            {users.map((user) => (
              <button key={user.id} type="button" onClick={() => identity.changeUser(user.id)}>
                {t('切换为')} {user.name}（{user.responsibilities.map(t).join(' · ')}）
              </button>
            ))}
          </div>
        </>
      ) : <p>{t('请从右上角账户切换有权限的用户，或返回工作台。')}</p>}
      <button type="button" onClick={() => navigate('/scenes/O01')}>{t('返回工作台')}</button>
    </section>
  );
}
