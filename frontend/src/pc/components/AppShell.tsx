import { usePreferences } from '../../common/preferences/context';
import {
  AlertOutlined,
  AppstoreOutlined,
  AuditOutlined,
  DashboardOutlined,
  FileTextOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
  TeamOutlined,
  TableOutlined,
  FolderOutlined,
  ProjectOutlined,
  UserOutlined
} from '@ant-design/icons';
import type { MouseEvent, PropsWithChildren, ReactElement, ReactNode } from 'react';
import { useMemo, useState } from 'react';

import { findScenario } from '../../common/scenarios/catalog';
import type { DemoRepository } from '../../common/store/repository';
import { useBrowserPath } from '../routes/useBrowserPath';
import styles from './AppShell.module.css';
import { AppearanceControls } from './AppearanceControls';
import { SessionMenu } from './SessionMenu';
import { McpConnection } from './McpConnection';
import { AwcpControls } from './AwcpControls';
import { RealtimeControls } from './RealtimeControls';

export interface AppLinkProps {
  href: string;
  navigate(path: string): void;
  children: ReactNode;
  className?: string;
  title?: string;
  ariaCurrent?: 'page';
}

export function AppLink({ href, navigate, children, className, title, ariaCurrent }: AppLinkProps): ReactElement {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };

  return (
    <a href={href} onClick={handleClick} className={className} title={title} aria-current={ariaCurrent}>
      {children}
    </a>
  );
}

interface AppShellProps extends PropsWithChildren {
  navigate(path: string): void;
  repository: DemoRepository;
  fillContent?: boolean;
}

interface NavMenuItem {
  key: string;
  title: string;
  path: string;
  icon: ReactElement;
  technicalFocus?: string;
  group?: string;
}

export function AppShell({ children, navigate, repository, fillContent = false }: AppShellProps): ReactElement {
  const { t } = usePreferences();
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useBrowserPath();

  const navItems: NavMenuItem[] = useMemo(
    () =>
      [
        {
          key: 'O01',
          title: t('工作台'),
          path: '/scenes/O01',
          icon: <DashboardOutlined />
        },
        { key: 'analysis', title: t('数据分析'), path: '/analysis', icon: <DashboardOutlined /> },
        {
          key: 'O08',
          title: t('审批中心'),
          path: '/scenes/O08',
          icon: <AuditOutlined />,
          group: t('协同办公')
        },
        {
          key: 'S01',
          title: t('客户与适当性'),
          path: '/scenes/S01',
          icon: <UserOutlined />,
          group: t('业务场景')
        },
        {
          key: 'S02',
          title: t('研报中心'),
          path: '/scenes/S02',
          icon: <FileTextOutlined />,
          group: t('业务场景')
        },
        {
          key: 'S04',
          title: t('风险监控'),
          path: '/scenes/S04',
          icon: <AlertOutlined />,
          group: t('业务场景')
        },
        { key: 'S03', title: t('投行项目'), path: '/scenes/S03', icon: <ProjectOutlined />, group: t('业务场景') },
        { key: 'S05', title: t('机构服务'), path: '/scenes/S05', icon: <TeamOutlined />, group: t('业务场景') },
        { key: 'O07', title: t('表格处理'), path: '/scenes/O07', icon: <TableOutlined />, group: t('业务场景') },
        { key: 'O06', title: t('文档中心'), path: '/scenes/O06', icon: <FolderOutlined />, group: t('业务场景') }
      ].map((item) => ({
        ...item,
        technicalFocus: item.group === t('业务场景') ? t(findScenario(item.key)?.technicalFocus ?? '') : undefined
      })),
    [t]
  );

  // Derive breadcrumbs based on pathname
  const breadcrumbs = useMemo(() => {
    if (pathname === '/' || pathname === '') {
      return [{ title: t('工作台') }];
    }
    if (pathname === '/navigation') return [{ title: t('首页'), path: '/' }, { title: t('站内导航') }];
    if (pathname === '/analysis') return [{ title: t('首页'), path: '/' }, { title: t('数据分析') }];
    const match = /^\/scenes\/([A-Z]\d{2})/.exec(pathname);
    if (!match) {
      return [{ title: t('首页'), path: '/' }, { title: t('未知页面') }];
    }
    const scenarioId = match[1];
    const scenario = findScenario(scenarioId);
    const categoryTitle =
      scenario?.group === 'securities' ? t('业务场景') : scenario?.group === 'office' ? t('协同办公') : t('协议实验');

    return [
      { title: t('首页'), path: '/' },
      { title: categoryTitle },
      { title: scenario ? `${scenario.id} ${t(scenario.title)}` : scenarioId }
    ];
  }, [pathname, t]);

  return (
    <div className={`${styles.shell} ${fillContent ? styles.fillShell : ''}`}>
      {/* Collapsible Enterprise Sidebar */}
      <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brandLogo}>D</div>
          {!collapsed && (
            <div className={styles.brandInfo}>
              <span className={styles.brandTitle}>demo-site</span>
              <span className={styles.brandSubtitle}>{t('业务场景')}</span>
            </div>
          )}
        </div>

        <nav className={styles.navContainer} aria-label={t('侧边栏主导航')}>
          {navItems.map((item, index) => {
            const isActive =
              item.path === '/'
                ? pathname === '/' || pathname === ''
                : pathname.startsWith(item.path) || (item.key === 'O01' && pathname === '/');

            const showGroup = !collapsed && item.group && (index === 0 || navItems[index - 1].group !== item.group);

            return (
              <div key={item.key}>
                {showGroup && <div className={styles.navGroupTitle}>{item.group}</div>}
                <AppLink
                  href={item.path}
                  navigate={navigate}
                  className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                  ariaCurrent={isActive ? 'page' : undefined}
                  title={[item.title, item.technicalFocus].filter(Boolean).join(' · ')}
                >
                  <span className={styles.navItemIcon}>{item.icon}</span>
                  {!collapsed && (
                    <>
                      <span className={styles.navLabel}>
                        <span>{item.title}</span>
                        {item.technicalFocus && <small>{item.technicalFocus}</small>}
                      </span>
                    </>
                  )}
                </AppLink>
              </div>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <button
            type="button"
            className={styles.collapseButton}
            onClick={() => setCollapsed((prev) => !prev)}
            title={collapsed ? t('展开侧边栏') : t('收起侧边栏')}
            aria-label={collapsed ? t('展开侧边栏') : t('收起侧边栏')}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        </div>
      </aside>

      {/* Main Wrapper */}
      <div className={styles.mainWrapper}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <nav aria-label={t('面包屑')} className={styles.breadcrumb}>
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <span key={crumb.title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {idx > 0 && <RightOutlined className={styles.breadcrumbSeparator} />}
                    {crumb.path && !isLast ? (
                      <AppLink href={crumb.path} navigate={navigate} className={styles.breadcrumbItem}>
                        {crumb.title}
                      </AppLink>
                    ) : (
                      <span className={isLast ? styles.breadcrumbCurrent : styles.breadcrumbItem}>{crumb.title}</span>
                    )}
                  </span>
                );
              })}
            </nav>
          </div>

          <div className={styles.headerRight}>
            <AppLink href="/navigation" navigate={navigate} className={styles.siteNavigation}>
              <AppstoreOutlined /> {t('站内导航')}
            </AppLink>

            <AwcpControls />
            <McpConnection />
            <RealtimeControls />
            <AppearanceControls />
          </div>
          <div className={styles.accountControl}><SessionMenu repository={repository} /></div>
        </header>

        <main className={styles.mainContent}>{children}</main>
      </div>
    </div>
  );
}
