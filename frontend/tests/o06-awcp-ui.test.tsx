import { createIdentityHarness } from './identityHarness';
import type { AwcpActionResponse, AwcpManualSection, JsonObject } from '@app/awcp';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it } from 'vitest';

import { AppProviders } from '../src/app/AppProviders';
import { siteForRoute } from '../src/common/awcp/site';
import { DemoRepository } from '../src/common/store/repository';
import O06DocumentPage from '../src/pc/pages/O06DocumentPage';
import { resolveRoute, scopeKeyForRoute } from '../src/pc/routes/route';

function render(repository: DemoRepository, container: HTMLDivElement) {
  const route = resolveRoute('/scenes/O06');
  const root = createRoot(container);
  const identity = createIdentityHarness('EMP-003');
  return {
    root,
    identity,
    element: (
      <identity.Provider><AppProviders site={siteForRoute(route)} scopeKey={scopeKeyForRoute(route)}>
        <O06DocumentPage repository={repository} />
      </AppProviders></identity.Provider>
    )
  };
}

it('discovers O06 through both Core manual levels and replays revision, review and archive', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  document.body.append(container);
  const { root, element } = render(repository, container);
  try {
    await act(async () => root.render(element));
    const api = window.awcp;
    if (!api) throw new Error('AWCP bridge is missing.');
    const index = api.manual();
    if (!('sections' in index)) throw new Error('Expected manual index.');
    const actions = [
      'office.document.query',
      'office.document.read',
      'office.document.draft.patch',
      'office.document.revision.approve',
      'office.document.archive'
    ];
    for (const action of actions) expect(index.sections.some((item) => item.section === action)).toBe(true);
    const example = (action: string): JsonObject => {
      const section = api.manual({ section: action, revision: index.revision }) as AwcpManualSection;
      const item = section.examples?.[0];
      if (!item) throw new Error(`Missing example: ${action}`);
      return item;
    };
    let count = 0;
    const invoke = async (action: string, args: JsonObject): Promise<AwcpActionResponse> => {
      let response: AwcpActionResponse | undefined;
      await act(async () => {
        response = await api.invoke({ action, args, requestId: `o06-awcp-${++count}`, revision: index.revision });
      });
      if (!response) throw new Error(`No response: ${action}`);
      return response;
    };
    expect(await invoke('office.document.query', example('office.document.query'))).toMatchObject({
      ok: true,
      result: {
        data: {
          items: [expect.objectContaining({ documentId: 'DOC-001', source: '办公制度库', documentVersion: 1 })]
        }
      }
    });
    expect(
      await invoke('office.document.query', { ...example('office.document.query'), keyword: '不存在' })
    ).toMatchObject({
      ok: true,
      result: { data: { items: [] } }
    });
    expect(await invoke('office.document.read', example('office.document.read'))).toMatchObject({
      ok: true,
      result: {
        data: { blocks: [expect.objectContaining({ id: 'DBLK-001' }), expect.objectContaining({ id: 'DBLK-002' })] }
      }
    });
    const initial = repository.snapshot();
    expect(
      await invoke('office.document.draft.patch', {
        ...example('office.document.draft.patch'),
        blockId: 'DBLK-999',
        idempotencyKey: 'o06-bad-block'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments', details: { executionStarted: false } } });
    expect(
      await invoke('office.document.revision.approve', {
        ...example('office.document.revision.approve'),
        documentVersion: 99,
        idempotencyKey: 'o06-bad-version'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments', details: { executionStarted: false } } });
    expect(repository.snapshot()).toEqual(initial);
    expect(await invoke('office.document.archive', example('office.document.archive'))).toMatchObject({
      ok: true,
      result: { data: { documentId: 'DOC-002', status: 'archived', documentVersion: 1 } }
    });
    expect(await invoke('office.document.revision.approve', example('office.document.revision.approve'))).toMatchObject(
      {
        ok: true,
        result: { data: { documentId: 'DOC-001', status: 'approved', documentVersion: 1 } }
      }
    );
    expect(
      await invoke('office.document.draft.patch', {
        ...example('office.document.draft.patch'),
        expectedVersion: 2,
        idempotencyKey: 'o06-patch-after-v1'
      })
    ).toMatchObject({ ok: true, result: { data: { documentId: 'DOC-001', status: 'draft', documentVersion: 2 } } });
    expect(await invoke('office.document.read', { ...example('office.document.read'), version: 2 })).toMatchObject({
      ok: true,
      result: {
        data: {
          approval: null,
          blocks: [
            expect.objectContaining({ id: 'DBLK-001' }),
            expect.objectContaining({ id: 'DBLK-002', text: '仅供虚构业务流程演示，已更新。' })
          ]
        }
      }
    });
    expect(
      await invoke('office.document.archive', {
        ...example('office.document.archive'),
        documentId: 'DOC-001',
        documentVersion: 2,
        expectedVersion: 3,
        idempotencyKey: 'o06-archive-unapproved'
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_arguments', details: { executionStarted: false } } });
    expect(
      await invoke('office.document.revision.approve', {
        ...example('office.document.revision.approve'),
        documentVersion: 2,
        expectedVersion: 3,
        idempotencyKey: 'o06-approve-v2'
      })
    ).toMatchObject({ ok: true, result: { data: { documentVersion: 2, status: 'approved' } } });
    expect(
      await invoke('office.document.archive', {
        ...example('office.document.archive'),
        documentId: 'DOC-001',
        documentVersion: 2,
        expectedVersion: 4,
        idempotencyKey: 'o06-archive-v2'
      })
    ).toMatchObject({ ok: true, result: { data: { documentVersion: 2, status: 'archived' } } });
    expect(repository.snapshot().officeDocumentArchives).toHaveLength(2);
    const after = api.manual();
    if (!('sections' in after)) throw new Error('Expected manual index after workflow.');
    expect(after.revision).toBe(index.revision);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('shares document state between page controls and service records', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  document.body.append(container);
  const { root, element, identity } = render(repository, container);
  try {
    await act(async () => root.render(element));
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
      if (!button) throw new Error(`Missing button: ${label}`);
      await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    };
    const textarea = container.querySelector<HTMLTextAreaElement>('#o06-block-text');
    if (!textarea) throw new Error('Block editor is missing.');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Text area value setter is missing.');
    await act(async () => {
      setter.call(textarea, '页面提交的虚构修订内容。');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('保存块修订');
    expect(
      repository.snapshot().documentVersions.find((item) => item.documentId === 'DOC-001' && item.version === 2)
        ?.blocks[1].text
    ).toBe('页面提交的虚构修订内容。');
    await identity.switchUser('EMP-004');
    await click('批准当前修订');
    await click('归档已批准版本');
    expect(repository.snapshot().officeDocuments.find((item) => item.id === 'DOC-001')).toMatchObject({
      currentVersion: 2,
      status: 'archived'
    });
    expect(container.textContent).toContain('归档：OARCH-001');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
