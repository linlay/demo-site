import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { AppProviders } from '../src/app/AppProviders';
import { findScenario } from '../src/common/scenarios/catalog';
import { DemoRepository } from '../src/common/store/repository';
import BusinessScenePage from '../src/pc/pages/BusinessScenePage';
import S01ClientPage from '../src/pc/pages/S01ClientPage';
import { SuitabilityService } from '../src/pc/service/suitabilityService';
import { businessPageReadValidator } from '../src/pc/service/businessPageAccess';
import { createIdentityHarness } from './identityHarness';

it('handles denied client access without throwing, names eligible users and restores the detail after switching', async () => {
  const repository = new DemoRepository();
  const scenario = findScenario('S01');
  if (!scenario) throw new Error('Missing S01');
  const identity = createIdentityHarness('EMP-003');
  const host = document.createElement('div');
  const root = createRoot(host);
  const errors = vi.fn();
  const log = vi.spyOn(console, 'error');
  const read = vi.spyOn(SuitabilityService.prototype, 'read');
  const before = repository.snapshot();
  window.addEventListener('error', errors);
  try {
    await act(async () => root.render(
      <StrictMode><identity.Provider>
        <AppProviders site={{ name: 'test', description: 'test' }} scopeKey="access-test" exposeAwcp={false}>
          <BusinessScenePage scenario={scenario} repository={repository} objectId="CLI-001" navigate={() => undefined}>
            <S01ClientPage repository={repository} objectId="CLI-001" />
          </BusinessScenePage>
        </AppProviders>
      </identity.Provider></StrictMode>
    ));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('当前用户无法查看此页面');
    const choices = [...host.querySelectorAll('button')].filter((button) => button.textContent?.startsWith('切换为'));
    expect(choices).toHaveLength(2);
    expect(choices[0].textContent).toContain('林悦（客户经理');
    expect(choices[1].textContent).toContain('赵敏（客户复核');
    expect(host.textContent).not.toContain('投资者 KYC 档案与问卷');
    expect(host.textContent).not.toContain('客户类型：');
    expect(read).not.toHaveBeenCalled();
    await act(async () => choices[0].click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('投资者 KYC 档案与问卷');
    expect(read.mock.calls.every(([input]) => input.actorId === 'EMP-001')).toBe(true);
    await identity.switchUser('EMP-002');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('切换为 赵敏'))?.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(read.mock.calls.at(-1)?.[0].actorId).toBe('EMP-004');
    expect(errors).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(repository.snapshot()).toEqual(before);
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener('error', errors);
    read.mockRestore();
    log.mockRestore();
  }
});

it.each([
  ['S02', 'researchReports', 'EMP-001', 'EMP-003'],
  ['S03', 'ibProjects', 'EMP-001', 'EMP-008'],
  ['S04', 'riskAlerts', 'EMP-001', 'EMP-006'],
  ['S05', 'institutionNeeds', 'EMP-004', 'EMP-001']
] as const)('guards %s with its existing domain rule before rendering detail content', async (scene, collection, denied, allowed) => {
  const repository = new DemoRepository();
  const objectId = repository.snapshot()[collection][0].id;
  const scenario = findScenario(scene);
  if (!scenario) throw new Error('Missing scene');
  const validate = businessPageReadValidator(repository, scene, objectId);
  expect(validate?.(denied).length).toBeGreaterThan(0);
  expect(validate?.(allowed)).toEqual([]);
  const renderDetail = vi.fn((): ReactElement => <p>restricted detail</p>);
  const identity = createIdentityHarness(denied);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(
      <identity.Provider><BusinessScenePage scenario={scenario} repository={repository} objectId={objectId} navigate={() => undefined}>
        {renderDetailElement(renderDetail)}
      </BusinessScenePage></identity.Provider>
    ));
    expect(renderDetail).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await identity.switchUser(allowed);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(renderDetail).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

function renderDetailElement(Detail: () => ReactElement): ReactElement {
  return <Detail />;
}
