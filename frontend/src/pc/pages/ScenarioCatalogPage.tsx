import { useState } from 'react';
import { usePreferences } from '../../common/preferences/context';
import { SCENARIOS, SCENARIO_GROUPS } from '../../common/scenarios/catalog';
import { AppLink } from '../components/AppShell';
import styles from './ScenarioCatalogPage.module.css';

export default function ScenarioCatalogPage({ navigate }: { navigate(path: string): void }) {
  const { t, locale } = usePreferences();
  const [keyword, setKeyword] = useState('');
  const query = keyword.trim().toLocaleLowerCase();
  const matches = SCENARIOS.filter((scene) =>
    [scene.id, scene.title, scene.technicalFocus, t(scene.title), t(scene.technicalFocus)]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query)
  );
  return (
    <section className={styles.catalogContainer} aria-label={t('站内导航')}>
      <header className={styles.heading}>
        <span>
          {locale === 'zh-CN'
            ? `${matches.length} / ${SCENARIOS.length} 个场景`
            : `${matches.length} / ${SCENARIOS.length} scenarios`}
        </span>
      </header>
      <label className={styles.search}>
        {t('查找场景')}
        <input
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('业务名称、技术能力或场景编号')}
        />
      </label>
      {SCENARIO_GROUPS.map((group) => {
        const scenes = matches.filter((scene) => scene.group === group.id);
        return scenes.length ? (
          <section key={group.id} aria-labelledby={`group-${group.id}`}>
            <h2 id={`group-${group.id}`} className={styles.groupHeading}>
              {t(group.title)} <small>{scenes.length}</small>
            </h2>
            <ul className={styles.grid}>
              {scenes.map((scene) => (
                <li key={scene.id}>
                  <AppLink href={scene.path} navigate={navigate} className={styles.cardLink}>
                    <span className={styles.id}>{scene.id}</span>
                    <strong>{t(scene.title)}</strong>
                    <small>{t(scene.technicalFocus)}</small>
                  </AppLink>
                </li>
              ))}
            </ul>
          </section>
        ) : null;
      })}
      {!matches.length && <p role="status">{t('没有匹配的场景')}</p>}
    </section>
  );
}
