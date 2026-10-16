import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  DOCUMENT_DECISION_SCHEMA,
  DOCUMENT_PATCH_SCHEMA,
  DOCUMENT_QUERY_SCHEMA,
  DOCUMENT_READ_SCHEMA
} from '../../common/awcp/documentSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  DocumentService,
  type DocumentDecisionInput,
  type DocumentPatchInput,
  type DocumentQueryInput,
  type DocumentReadInput
} from '../service/documentService';
import styles from './O06DocumentPage.module.css';

const QUERY: DocumentQueryInput = { actorId: 'EMP-003', keyword: '办公' };
const READ: DocumentReadInput = { actorId: 'EMP-003', documentId: 'DOC-001', version: null };
const PATCH: DocumentPatchInput = {
  actorId: 'EMP-003',
  documentId: 'DOC-001',
  expectedVersion: 1,
  blockId: 'DBLK-002',
  text: '仅供虚构业务流程演示，已更新。',
  idempotencyKey: 'o06-patch-example'
};
const APPROVE: DocumentDecisionInput = {
  actorId: 'EMP-004',
  documentId: 'DOC-001',
  documentVersion: 1,
  expectedVersion: 1,
  idempotencyKey: 'o06-approve-example'
};
const ARCHIVE: DocumentDecisionInput = {
  actorId: 'EMP-004',
  documentId: 'DOC-002',
  documentVersion: 1,
  expectedVersion: 2,
  idempotencyKey: 'o06-archive-example'
};

function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '提供虚构文档和人员 ID；写操作带业务版本及稳定幂等键，审批和归档绑定文档版本。',
    effects,
    result: '返回来源、版本、块内容、审阅与归档记录或状态。',
    failures: '块 ID、权限、状态或版本不符时返回字段错误且不写入。'
  });
}
function key(): string {
  return `o06-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O06DocumentPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new DocumentService(repository));
  const actorId = useCurrentActor('EMP-003');
  const reviewerId = actorId;
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState(objectId ?? 'DOC-001');
  const [viewVersion, setViewVersion] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState('DBLK-002');
  const [blockText, setBlockText] = useState('');
  const [message, setMessage] = useState('');
  const [, setRevision] = useState(0);

  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const results = service.query({ actorId, keyword });
  const documentId = results.items.some((item) => item.documentId === selected)
    ? selected
    : String(results.items[0]?.documentId ?? '');
  const view = documentId
    ? service.read({ actorId, documentId, version: viewVersion ? Number(viewVersion) : null })
    : null;
  const blocks = (view?.blocks as Array<{ id: string; kind: string; text: string }> | undefined) ?? [];
  const blockId = blocks.some((item) => item.id === selectedBlockId) ? selectedBlockId : (blocks[0]?.id ?? '');
  const block = blocks.find((item) => item.id === blockId);
  useEffect(() => setBlockText(block?.text ?? ''), [documentId, view?.documentVersion, blockId, block?.text]);

  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }

  const queryAction: AwcpActionRegistration<DocumentQueryInput> = {
    action: 'office.document.query',
    title: '检索制度文档',
    description: guide(
      '检索虚构制度文档标题、来源和块内容。',
      '有效人员提供关键词；空词返回全部。',
      '只读返回文件 ID、版本与来源，空结果为空数组。'
    ),
    inputSchema: DOCUMENT_QUERY_SCHEMA,
    examples: [QUERY],
    validate: (args) => service.validateQuery(args),
    invoke: (args) => completed(service.query(args))
  };
  useAwcpAction(queryAction);
  const readAction: AwcpActionRegistration<DocumentReadInput> = {
    action: 'office.document.read',
    title: '读取制度文档',
    description: guide('读取指定或当前文档版本的结构化块、来源、审阅及归档。', '文档和版本存在；人员有效。', '只读。'),
    inputSchema: DOCUMENT_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const patchAction: AwcpActionRegistration<DocumentPatchInput> = {
    action: 'office.document.draft.patch',
    title: '编辑文档草稿块',
    description: guide(
      '按块 ID 修订当前文档并生成不可变新版本。',
      '文档负责人、有效块 ID、内容和业务版本。',
      '新版本置为待审阅草稿，保留旧版本。'
    ),
    inputSchema: DOCUMENT_PATCH_SCHEMA,
    examples: [PATCH],
    validate: (args) => service.validatePatch(args),
    invoke: (args) => completed(service.patch(args))
  };
  useAwcpAction(patchAction);
  const approveAction: AwcpActionRegistration<DocumentDecisionInput> = {
    action: 'office.document.revision.approve',
    title: '批准文档修订',
    description: guide(
      '批准指定的当前草稿版本。',
      '指定审阅人、当前版本与业务版本一致。',
      '生成绑定文档版本的唯一审阅记录。'
    ),
    inputSchema: DOCUMENT_DECISION_SCHEMA,
    examples: [APPROVE],
    validate: (args) => service.validateApprove(args),
    invoke: (args) => completed(service.approve(args))
  };
  useAwcpAction(approveAction);
  const archiveAction: AwcpActionRegistration<DocumentDecisionInput> = {
    action: 'office.document.archive',
    title: '归档已批准版本',
    description: guide(
      '归档当前已批准的制度文档。',
      '指定审阅人、当前版本批准记录和业务版本一致。',
      '生成可追踪归档记录并冻结编辑。'
    ),
    inputSchema: DOCUMENT_DECISION_SCHEMA,
    examples: [ARCHIVE],
    validate: (args) => service.validateArchive(args),
    invoke: (args) => completed(service.archive(args))
  };
  useAwcpAction(archiveAction);

  return (
    <section className={styles.page} aria-label="文档与知识库">


      <p>检索制度，按文档块修订版本，审阅当前版本并归档。</p>
      <div className={styles.panel}>
        <h2>检索与读取</h2>
        <div className={styles.grid}>


          <label htmlFor="o06-keyword">检索关键词</label>
          <input id="o06-keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <label htmlFor="o06-document">文件</label>
          <select
            id="o06-document"
            value={documentId}
            onChange={(event) => {
              setSelected(event.target.value);
              setViewVersion('');
            }}
          >
            {results.items.map((item) => (
              <option key={String(item.documentId)} value={String(item.documentId)}>
                {String(item.documentId)} · {String(item.title)} · v{String(item.documentVersion)}
              </option>
            ))}
          </select>
          <label htmlFor="o06-version">读取版本</label>
          <select
            id="o06-version"
            value={viewVersion}
            onChange={(event) => setViewVersion(event.target.value)}
            disabled={!documentId}
          >
            <option value="">当前版本</option>
            {service.versions(documentId).map((version) => (
              <option key={version} value={version}>
                v{version}
              </option>
            ))}
          </select>
        </div>
        <p>
          检索命中 {results.items.length} 份；
          {results.items.length === 0 ? '没有匹配的文档。' : '可读取文件 ID、版本及来源。'}
        </p>
        {view && (
          <div className={styles.record} aria-label="文档内容">
            <strong>{String(view.title)}</strong>
            <p>
              {String(view.documentId)} · 来源 {String(view.source)} · 文档版本 {String(view.documentVersion)} ·
              业务版本 {String(view.businessVersion)} · {String(view.status)}
            </p>
            <ol>
              {blocks.map((item) => (
                <li key={item.id}>
                  {item.id} · {item.kind}：{item.text}
                </li>
              ))}
            </ol>
            <p>
              审阅：{view.approval ? String((view.approval as Record<string, unknown>).id) : '未批准'}；归档：
              {view.archive ? String((view.archive as Record<string, unknown>).id) : '未归档'}
            </p>
          </div>
        )}
      </div>
      <div className={styles.panel}>
        <h2>块编辑与版本</h2>
        <div className={styles.grid}>
          <label htmlFor="o06-block">文档块</label>
          <select
            id="o06-block"
            value={blockId}
            onChange={(event) => setSelectedBlockId(event.target.value)}
            disabled={!view}
          >
            {blocks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {item.kind}
              </option>
            ))}
          </select>
          <label htmlFor="o06-block-text">新块内容</label>
          <textarea
            id="o06-block-text"
            rows={3}
            value={blockText}
            onChange={(event) => setBlockText(event.target.value)}
          />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!view || view.status === 'archived' || viewVersion !== '' || !blockText.trim()}
            onClick={() =>
              run(() => {
                const result = service.patch({
                  actorId,
                  documentId,
                  expectedVersion: Number(view?.businessVersion),
                  blockId,
                  text: blockText,
                  idempotencyKey: key()
                });
                setViewVersion('');
                return `${result.documentId} 已生成 v${result.documentVersion} 草稿。`;
              })
            }
          >
            保存块修订
          </button>
        </div>
      </div>
      <div className={styles.panel}>
        <h2>审阅与归档</h2>
        <div className={styles.grid}>


        </div>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!view || view.status !== 'draft' || viewVersion !== ''}
            onClick={() =>
              run(() => {
                const result = service.approve({
                  actorId: reviewerId,
                  documentId,
                  documentVersion: Number(view?.currentVersion),
                  expectedVersion: Number(view?.businessVersion),
                  idempotencyKey: key()
                });
                return `${result.documentId} v${result.documentVersion} 已批准。`;
              })
            }
          >
            批准当前修订
          </button>
          <button
            type="button"
            disabled={!view || view.status !== 'approved' || viewVersion !== ''}
            onClick={() =>
              run(() => {
                const result = service.archive({
                  actorId: reviewerId,
                  documentId,
                  documentVersion: Number(view?.currentVersion),
                  expectedVersion: Number(view?.businessVersion),
                  idempotencyKey: key()
                });
                return `${result.documentId} v${result.documentVersion} 已归档。`;
              })
            }
          >
            归档已批准版本
          </button>
        </div>
        {view && (
          <div className={styles.record} aria-label="文档审计">
            <p>当前文档版本 {String(view.currentVersion)}；审批只对该具体版本生效。</p>
            <ol>
              {(view.history as Array<Record<string, unknown>>).map((item, index) => (
                <li key={index}>
                  {String(item.action)} · 业务版本 {String(item.businessVersion)} · {String(item.note ?? '')}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
