import { useAwcpSettings } from './awcpSettingsContext';
import { usePreferences } from '../common/preferences/context';
import { lazy, Suspense, useState, type ReactElement } from 'react';

import '../styles/theme.css';
import { siteForRoute } from '../common/awcp/site';
import { createBrowserRepository } from '../common/store/repository';
import { AppShell } from '../pc/components/AppShell';
import { resolveRoute, scopeKeyForRoute } from '../pc/routes/route';
import { useBrowserPath } from '../pc/routes/useBrowserPath';
import { useDemoSession } from '../pc/hooks/useDemoSession';
import { createSessionRepository } from '../pc/service/sessionRepository';
import { AppProviders } from './AppProviders';

const AnalysisPage = lazy(() => import('../pc/pages/AnalysisPage'));
const ScenarioCatalogPage = lazy(() => import('../pc/pages/ScenarioCatalogPage'));
const BusinessScenePage = lazy(() => import('../pc/pages/BusinessScenePage'));
const B06WorkspacePage = lazy(() => import('../pc/pages/B06WorkspacePage'));
const S01ClientPage = lazy(() => import('../pc/pages/S01ClientPage'));
const S02ResearchPage = lazy(() => import('../pc/pages/S02ResearchPage'));
const S02ResearchNewPage = lazy(() => import('../pc/pages/S02ResearchNewPage'));
const S03IbProjectPage = lazy(() => import('../pc/pages/S03IbProjectPage'));
const S03IbProjectNewPage = lazy(() => import('../pc/pages/S03IbProjectNewPage'));
const S04RiskPage = lazy(() => import('../pc/pages/S04RiskPage'));
const S05InstitutionPage = lazy(() => import('../pc/pages/S05InstitutionPage'));
const P01DiscoveryPage = lazy(() => import('../pc/pages/P01DiscoveryPage'));
const P02SchemaPage = lazy(() => import('../pc/pages/P02SchemaPage'));
const P03ValidationPage = lazy(() => import('../pc/pages/P03ValidationPage'));
const P04RevisionPage = lazy(() => import('../pc/pages/P04RevisionPage'));
const P05LifecyclePage = lazy(() => import('../pc/pages/P05LifecyclePage'));
const P06CancellationPage = lazy(() => import('../pc/pages/P06CancellationPage'));
const P07IdempotencyPage = lazy(() => import('../pc/pages/P07IdempotencyPage'));
const P08ErrorsPage = lazy(() => import('../pc/pages/P08ErrorsPage'));
const P09DynamicPage = lazy(() => import('../pc/pages/P09DynamicPage'));
const P10CapacityPage = lazy(() => import('../pc/pages/P10CapacityPage'));
const O01TodoPage = lazy(() => import('../pc/pages/O01TodoPage'));
const O02DirectoryPage = lazy(() => import('../pc/pages/O02DirectoryPage'));
const O03NoticePage = lazy(() => import('../pc/pages/O03NoticePage'));
const O03NoticeNewPage = lazy(() => import('../pc/pages/O03NoticeNewPage'));
const O04CommunicationPage = lazy(() => import('../pc/pages/O04CommunicationPage'));
const O05MeetingPage = lazy(() => import('../pc/pages/O05MeetingPage'));
const O06DocumentPage = lazy(() => import('../pc/pages/O06DocumentPage'));
const O07SheetPage = lazy(() => import('../pc/pages/O07SheetPage'));
const O08ApprovalPage = lazy(() => import('../pc/pages/O08ApprovalPage'));
const O08ApprovalNewPage = lazy(() => import('../pc/pages/O08ApprovalNewPage'));
const O10HrPage = lazy(() => import('../pc/pages/O10HrPage'));
const O10HrNewPage = lazy(() => import('../pc/pages/O10HrNewPage'));
const O11ProcurementPage = lazy(() => import('../pc/pages/O11ProcurementPage'));
const O11ProcurementNewPage = lazy(() => import('../pc/pages/O11ProcurementNewPage'));
const O12ContractPage = lazy(() => import('../pc/pages/O12ContractPage'));
const O13AdminPage = lazy(() => import('../pc/pages/O13AdminPage'));
const O14ProjectPage = lazy(() => import('../pc/pages/O14ProjectPage'));
const O15ItPage = lazy(() => import('../pc/pages/O15ItPage'));
const O16ReportPage = lazy(() => import('../pc/pages/O16ReportPage'));
const OfficeNewPage = lazy(() => import('../pc/pages/OfficeNewPage'));

export function App(): ReactElement {
  const { t } = usePreferences();
  const demo = useDemoSession();
  const awcp = useAwcpSettings();
  const [repository] = useState(() => demo ? createSessionRepository(demo.session, () => {
    if (!demo.api.canWriteSession(demo.session.id, demo.session.generation)) throw new Error('演示空间已变化，请先载入最新数据。');
  }) : createBrowserRepository());
  const { pathname, navigate } = useBrowserPath();
  const route = resolveRoute(pathname);
  const scopeKey = scopeKeyForRoute(route);

  return (
    <AppProviders key={scopeKey} site={siteForRoute(route)} scopeKey={scopeKey} exposeAwcp={awcp.settings?.activeEnabled === true}>
      <AppShell navigate={navigate} repository={repository}>
        <Suspense fallback={<p role="status">{t("正在加载场景…")}</p>}>
          {route.kind === 'analysis' && <AnalysisPage />}
          {route.kind === 'catalog' && <ScenarioCatalogPage navigate={navigate} />}
          {route.kind === 'scene' && route.scenario.id === 'O01' && (
            <O01TodoPage repository={repository} navigate={navigate} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.group !== 'protocol' && route.scenario.id !== 'O01' && (
            <BusinessScenePage
              scenario={route.scenario}
              repository={repository}
              navigate={navigate}
              objectId={route.objectId}
              formType={route.formType}
            >
              <>
          {route.kind === 'scene' && route.scenario.id === 'O09' && (
            <B06WorkspacePage repository={repository} objectId={route.objectId} formType={route.formType} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O02' && <O02DirectoryPage repository={repository} />}
          {route.kind === 'scene' && route.scenario.id === 'O03' && (
            route.formType ? <O03NoticeNewPage repository={repository} /> : <O03NoticePage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O04' && (
            route.formType ? <OfficeNewPage repository={repository} scenarioId="O04" /> : <O04CommunicationPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O05' && (
            route.formType ? <OfficeNewPage repository={repository} scenarioId="O05" /> : <O05MeetingPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O06' && (
            <O06DocumentPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O07' && <O07SheetPage repository={repository} />}
          {route.kind === 'scene' && route.scenario.id === 'O08' && (
            route.formType ? <O08ApprovalNewPage repository={repository} /> : <O08ApprovalPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O10' && (
            route.formType ? <O10HrNewPage repository={repository} formType={route.formType} /> : <O10HrPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O11' && (
            route.formType ? <O11ProcurementNewPage repository={repository} /> : <O11ProcurementPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O12' && (
            route.formType ? <OfficeNewPage repository={repository} scenarioId="O12" /> : <O12ContractPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O13' && (
            route.formType ? <OfficeNewPage repository={repository} scenarioId="O13" /> : route.objectId?.startsWith('RSV-') ? null : <O13AdminPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O14' && (
            route.formType ? <OfficeNewPage repository={repository} scenarioId="O14" /> : <O14ProjectPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O15' && (
            route.formType ? <OfficeNewPage repository={repository} scenarioId="O15" /> : route.objectId?.startsWith('AREQ-') ? null : <O15ItPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'O16' && (
            route.formType ? <OfficeNewPage repository={repository} scenarioId="O16" /> : <O16ReportPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'S01' && (
            <S01ClientPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'S02' && (
            route.formType ? <S02ResearchNewPage repository={repository} /> : <S02ResearchPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'S03' && (
            route.formType ? <S03IbProjectNewPage repository={repository} /> : <S03IbProjectPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'S04' && (
            <S04RiskPage repository={repository} objectId={route.objectId} />
          )}
          {route.kind === 'scene' && route.scenario.id === 'S05' && (
            <S05InstitutionPage repository={repository} objectId={route.objectId} />
          )}
              </>
            </BusinessScenePage>
          )}
          {route.kind === 'scene' && route.scenario.id === 'P01' && <P01DiscoveryPage />}
          {route.kind === 'scene' && route.scenario.id === 'P02' && <P02SchemaPage />}
          {route.kind === 'scene' && route.scenario.id === 'P03' && <P03ValidationPage repository={repository} />}
          {route.kind === 'scene' && route.scenario.id === 'P04' && <P04RevisionPage />}
          {route.kind === 'scene' && route.scenario.id === 'P05' && <P05LifecyclePage />}
          {route.kind === 'scene' && route.scenario.id === 'P06' && <P06CancellationPage repository={repository} />}
          {route.kind === 'scene' && route.scenario.id === 'P07' && <P07IdempotencyPage repository={repository} />}
          {route.kind === 'scene' && route.scenario.id === 'P08' && <P08ErrorsPage />}
          {route.kind === 'scene' && route.scenario.id === 'P09' && <P09DynamicPage />}
          {route.kind === 'scene' && route.scenario.id === 'P10' && <P10CapacityPage />}
          {route.kind === 'not-found' && <p role="alert">{t("未找到场景，请返回场景目录。")}</p>}
        </Suspense>
      </AppShell>
    </AppProviders>
  );
}
