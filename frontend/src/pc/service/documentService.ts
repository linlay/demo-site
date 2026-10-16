import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type {
  DemoState,
  DocumentVersion,
  OfficeDocument,
  OfficeDocumentApproval,
  OfficeDocumentArchive
} from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface DocumentQueryInput extends JsonObject {
  actorId: string;
  keyword: string;
}
export interface DocumentReadInput extends JsonObject {
  actorId: string;
  documentId: string;
  version: number | null;
}
export interface DocumentPatchInput extends JsonObject {
  actorId: string;
  documentId: string;
  expectedVersion: number;
  blockId: string;
  text: string;
  idempotencyKey: string;
}
export interface DocumentDecisionInput extends JsonObject {
  actorId: string;
  documentId: string;
  documentVersion: number;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface DocumentResult extends JsonObject {
  documentId: string;
  documentVersion: number;
  businessVersion: number;
  status: OfficeDocument['status'];
}
export interface DocumentQueryResult extends JsonObject {
  keyword: string;
  items: JsonObject[];
}

type Operation = 'draft.patch' | 'revision.approve' | 'archive';

export class DocumentService {
  constructor(private readonly repository: DemoRepository) {}

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  actors(): Array<{ id: string; name: string }> {
    return this.repository
      .snapshot()
      .employees.filter((item) => item.active)
      .map((item) => ({ id: item.id, name: item.name }));
  }
  versions(documentId: string): number[] {
    return this.repository
      .snapshot()
      .documentVersions.filter((item) => item.documentId === documentId)
      .map((item) => item.version)
      .sort((left, right) => right - left);
  }

  validateQuery(input: DocumentQueryInput): AwcpFieldError[] {
    return queryErrors(this.repository.snapshot(), input);
  }
  query(input: DocumentQueryInput): DocumentQueryResult {
    const state = this.repository.snapshot();
    assertValid(queryErrors(state, input));
    const keyword = input.keyword.trim().toLocaleLowerCase();
    return {
      keyword: input.keyword,
      items: state.officeDocuments.flatMap((document) => {
        const version = currentVersion(state, document);
        if (!version) return [];
        const searchable =
          `${document.id} ${document.source} ${version.title} ${version.blocks.map((item) => item.text).join(' ')}`.toLocaleLowerCase();
        if (keyword && !searchable.includes(keyword)) return [];
        return [
          {
            documentId: document.id,
            title: version.title,
            source: document.source,
            documentVersion: document.currentVersion,
            businessVersion: document.businessVersion,
            status: document.status
          }
        ];
      })
    };
  }

  validateRead(input: DocumentReadInput): AwcpFieldError[] {
    return readErrors(this.repository.snapshot(), input);
  }
  read(input: DocumentReadInput): JsonObject {
    const state = this.repository.snapshot();
    assertValid(readErrors(state, input));
    const document = state.officeDocuments.find((item) => item.id === input.documentId);
    if (!document) throw businessError('action.document-not-found', '文档不存在。');
    const version = state.documentVersions.find(
      (item) => item.documentId === document.id && item.version === (input.version ?? document.currentVersion)
    );
    if (!version) throw businessError('action.document-version-not-found', '文档版本不存在。');
    const approval = state.officeDocumentApprovals.find(
      (item) => item.documentId === document.id && item.documentVersion === version.version
    );
    const archive = state.officeDocumentArchives.find(
      (item) => item.documentId === document.id && item.documentVersion === version.version
    );
    return {
      documentId: document.id,
      title: version.title,
      source: document.source,
      ownerId: document.ownerId,
      reviewerId: document.reviewerId,
      documentVersion: version.version,
      currentVersion: document.currentVersion,
      businessVersion: document.businessVersion,
      status: document.status,
      blocks: version.blocks.map((item) => ({ id: item.id, kind: item.kind, text: item.text })),
      content: version.content,
      approval: approval
        ? {
            id: approval.id,
            reviewerId: approval.reviewerId,
            documentVersion: approval.documentVersion,
            approvedAt: approval.approvedAt
          }
        : null,
      archive: archive
        ? {
            id: archive.id,
            approvalId: archive.approvalId,
            documentVersion: archive.documentVersion,
            archivedBy: archive.archivedBy,
            archivedAt: archive.archivedAt
          }
        : null,
      history: state.auditEntries
        .filter((item) => item.entityType === 'document' && item.entityId === document.id)
        .map((item) => ({
          action: item.action,
          actorId: item.actorId,
          at: item.at,
          businessVersion: item.businessVersion,
          note: item.note ?? null
        }))
    };
  }

  validatePatch(input: DocumentPatchInput): AwcpFieldError[] {
    return patchErrors(this.repository.snapshot(), input);
  }
  patch(input: DocumentPatchInput): DocumentResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'draft.patch', input);
      if (previous) return previous;
      assertValid(patchErrors(state, input));
      const document = state.officeDocuments.find((item) => item.id === input.documentId);
      if (!document) throw businessError('action.document-not-found', '文档不存在。');
      const current = currentVersion(state, document);
      if (!current) throw businessError('action.document-version-not-found', '文档版本不存在。');
      const blocks = current.blocks.map((item) =>
        item.id === input.blockId ? { ...item, text: input.text.trim() } : { ...item }
      );
      const next: DocumentVersion = {
        id: nextId(
          'DOCVER',
          state.documentVersions.map((item) => item.id)
        ),
        documentId: document.id,
        version: document.currentVersion + 1,
        title: blocks.find((item) => item.kind === 'heading')?.text ?? current.title,
        content: blocks
          .filter((item) => item.kind === 'paragraph')
          .map((item) => item.text)
          .join('\n'),
        blocks,
        authorId: input.actorId,
        createdAt: this.repository.clock.now()
      };
      state.documentVersions.push(next);
      const from = document.status;
      document.currentVersion = next.version;
      document.businessVersion += 1;
      document.status = 'draft';
      audit(
        state,
        document,
        'draft.patch',
        input.actorId,
        from,
        this.repository.clock.now(),
        `${input.blockId} → v${next.version}`
      );
      return remember(state, 'draft.patch', input, document);
    });
  }

  validateApprove(input: DocumentDecisionInput): AwcpFieldError[] {
    return approveErrors(this.repository.snapshot(), input);
  }
  approve(input: DocumentDecisionInput): DocumentResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'revision.approve', input);
      if (previous) return previous;
      assertValid(approveErrors(state, input));
      const document = state.officeDocuments.find((item) => item.id === input.documentId);
      if (!document) throw businessError('action.document-not-found', '文档不存在。');
      const approval: OfficeDocumentApproval = {
        id: nextId(
          'OAPP',
          state.officeDocumentApprovals.map((item) => item.id)
        ),
        documentId: document.id,
        documentVersion: document.currentVersion,
        reviewerId: input.actorId,
        approvedAt: this.repository.clock.now()
      };
      state.officeDocumentApprovals.push(approval);
      const from = document.status;
      document.status = 'approved';
      document.businessVersion += 1;
      audit(
        state,
        document,
        'revision.approve',
        input.actorId,
        from,
        this.repository.clock.now(),
        `${approval.id} · v${approval.documentVersion}`
      );
      return remember(state, 'revision.approve', input, document);
    });
  }

  validateArchive(input: DocumentDecisionInput): AwcpFieldError[] {
    return archiveErrors(this.repository.snapshot(), input);
  }
  archive(input: DocumentDecisionInput): DocumentResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'archive', input);
      if (previous) return previous;
      assertValid(archiveErrors(state, input));
      const document = state.officeDocuments.find((item) => item.id === input.documentId);
      if (!document) throw businessError('action.document-not-found', '文档不存在。');
      const approval = state.officeDocumentApprovals.find(
        (item) => item.documentId === document.id && item.documentVersion === document.currentVersion
      );
      if (!approval) throw businessError('action.document-approval-not-found', '当前版本没有批准记录。');
      const archive: OfficeDocumentArchive = {
        id: nextId(
          'OARCH',
          state.officeDocumentArchives.map((item) => item.id)
        ),
        documentId: document.id,
        documentVersion: document.currentVersion,
        approvalId: approval.id,
        archivedBy: input.actorId,
        archivedAt: this.repository.clock.now()
      };
      state.officeDocumentArchives.push(archive);
      const from = document.status;
      document.status = 'archived';
      document.businessVersion += 1;
      audit(
        state,
        document,
        'archive',
        input.actorId,
        from,
        this.repository.clock.now(),
        `${archive.id} · ${approval.id}`
      );
      return remember(state, 'archive', input, document);
    });
  }
}

function queryErrors(state: DemoState, input: DocumentQueryInput): AwcpFieldError[] {
  const errors = actorErrors(state, input.actorId);
  if (typeof input.keyword !== 'string' || input.keyword.length > 120)
    errors.push(fieldError(['keyword'], '关键词须为至多 120 字。'));
  return errors;
}
function readErrors(
  state: DemoState,
  input: { actorId: string; documentId: string; version?: number | null }
): AwcpFieldError[] {
  const errors = actorErrors(state, input.actorId);
  const document = state.officeDocuments.find((item) => item.id === input.documentId);
  if (!document) return [...errors, fieldError(['documentId'], '文档不存在。')];
  if (
    input.version !== undefined &&
    input.version !== null &&
    (!Number.isSafeInteger(input.version) || input.version < 1)
  )
    errors.push(fieldError(['version'], '文档版本须为正整数。'));
  if (
    !state.documentVersions.some(
      (item) => item.documentId === document.id && item.version === (input.version ?? document.currentVersion)
    )
  )
    errors.push(fieldError(['version'], '文档版本不存在。'));
  return errors;
}
function patchErrors(state: DemoState, input: DocumentPatchInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = replayErrors(state, 'draft.patch', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...readErrors(state, input));
  const document = state.officeDocuments.find((item) => item.id === input.documentId);
  if (!document) return errors;
  if (document.ownerId !== input.actorId) errors.push(fieldError(['actorId'], '只有文档负责人可编辑。'));
  if (document.status === 'archived') errors.push(fieldError(['documentId'], '已归档文档不能编辑。'));
  if (document.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '文档业务版本已变化。'));
  if (!currentVersion(state, document)?.blocks.some((item) => item.id === input.blockId))
    errors.push(fieldError(['blockId'], '文档块 ID 不存在。'));
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.trim().length > 2000)
    errors.push(fieldError(['text'], '文档块内容须为 1～2000 字。'));
  return errors;
}
function approveErrors(state: DemoState, input: DocumentDecisionInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'approve');
    if (workflowDenied.length) return workflowDenied;
  const errors = replayErrors(state, 'revision.approve', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...readErrors(state, input));
  const document = state.officeDocuments.find((item) => item.id === input.documentId);
  if (!document) return errors;
  if (document.reviewerId !== input.actorId) errors.push(fieldError(['actorId'], '只有指定审阅人可批准修订。'));
  if (document.status !== 'draft') errors.push(fieldError(['documentId'], '只有草稿版本可批准。'));
  if (document.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '文档业务版本已变化。'));
  if (document.currentVersion !== input.documentVersion)
    errors.push(fieldError(['documentVersion'], '审阅版本不是当前版本。'));
  if (
    state.officeDocumentApprovals.some(
      (item) => item.documentId === document.id && item.documentVersion === input.documentVersion
    )
  )
    errors.push(fieldError(['documentVersion'], '此版本已有批准记录。'));
  return errors;
}
function archiveErrors(state: DemoState, input: DocumentDecisionInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'approve');
    if (workflowDenied.length) return workflowDenied;
  const errors = replayErrors(state, 'archive', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...readErrors(state, input));
  const document = state.officeDocuments.find((item) => item.id === input.documentId);
  if (!document) return errors;
  if (document.reviewerId !== input.actorId) errors.push(fieldError(['actorId'], '只有指定审阅人可归档。'));
  if (document.status !== 'approved') errors.push(fieldError(['documentId'], '只有当前已批准版本可归档。'));
  if (document.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '文档业务版本已变化。'));
  if (document.currentVersion !== input.documentVersion)
    errors.push(fieldError(['documentVersion'], '归档版本不是当前版本。'));
  if (
    !state.officeDocumentApprovals.some(
      (item) => item.documentId === document.id && item.documentVersion === document.currentVersion
    )
  )
    errors.push(fieldError(['documentVersion'], '当前版本没有批准记录。'));
  if (state.officeDocumentArchives.some((item) => item.documentId === document.id))
    errors.push(fieldError(['documentId'], '文档已有归档记录。'));
  return errors;
}
function currentVersion(state: DemoState, document: OfficeDocument): DocumentVersion | undefined {
  return state.documentVersions.find(
    (item) => item.documentId === document.id && item.version === document.currentVersion
  );
}
function actorErrors(state: DemoState, actorId: string): AwcpFieldError[] {
  return state.employees.some((item) => item.id === actorId && item.active)
    ? []
    : [fieldError(['actorId'], '操作人不存在或已停用。')];
}
function replayErrors(state: DemoState, operation: Operation, input: { idempotencyKey: string }): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  if (typeof input.idempotencyKey !== 'string' || !/^[\w.:-]{1,128}$/.test(input.idempotencyKey))
    errors.push(fieldError(['idempotencyKey'], '业务幂等键格式不正确。'));
  const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
  if (record && (record.operation !== `document.${operation}` || record.fingerprint !== fingerprint(input)))
    errors.push(fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。'));
  return errors;
}
function hasReplay(state: DemoState, key: string): boolean {
  return state.idempotencyRecords.some((item) => item.key === key);
}
function fingerprint(input: object): string {
  const { idempotencyKey: _key, ...fields } = input as Record<string, unknown>;
  return JSON.stringify(fields);
}
function replay(state: DemoState, operation: Operation, input: { idempotencyKey: string }): DocumentResult | null {
  const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
  if (!record) return null;
  if (record.operation !== `document.${operation}` || record.fingerprint !== fingerprint(input))
    throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
  if (
    record.resultVersion === null ||
    record.resultDocumentVersion === undefined ||
    (record.resultStatus !== 'draft' && record.resultStatus !== 'approved' && record.resultStatus !== 'archived')
  )
    throw new Error('Invalid document replay record.');
  return {
    documentId: record.resultId,
    documentVersion: record.resultDocumentVersion,
    businessVersion: record.resultVersion,
    status: record.resultStatus
  };
}
function remember(
  state: DemoState,
  operation: Operation,
  input: { idempotencyKey: string },
  document: OfficeDocument
): DocumentResult {
  state.idempotencyRecords.push({
    key: input.idempotencyKey,
    operation: `document.${operation}`,
    fingerprint: fingerprint(input),
    resultId: document.id,
    resultVersion: document.businessVersion,
    resultStatus: document.status,
    resultDocumentVersion: document.currentVersion
  });
  return {
    documentId: document.id,
    documentVersion: document.currentVersion,
    businessVersion: document.businessVersion,
    status: document.status
  };
}
function audit(
  state: DemoState,
  document: OfficeDocument,
  action: Operation,
  actorId: string,
  fromStatus: OfficeDocument['status'],
  at: string,
  note: string
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType: 'document',
    entityId: document.id,
    action,
    actorId,
    at,
    fromStatus,
    toStatus: document.status,
    businessVersion: document.businessVersion,
    note
  });
}
function nextId(prefix: string, ids: readonly string[]): string {
  const max = ids.reduce((current, id) => {
    const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(id);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}
function assertValid(errors: AwcpFieldError[]): void {
  if (errors.length) throw businessError('action.invalid-document', errors.flatMap((item) => item.messages).join('；'));
}
