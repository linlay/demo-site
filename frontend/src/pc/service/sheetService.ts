import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { DemoState, SheetRow } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface SheetFilterInput extends JsonObject {
  actorId: string;
  keyword: string;
  departmentId: string | null;
  status: SheetRow['status'] | null;
  minAmountCents: number | null;
  sortBy: 'id' | 'amountCents';
  sortDirection: 'asc' | 'desc';
}
export interface SheetQueryInput extends SheetFilterInput {
  page: number;
  pageSize: number;
}
export interface SheetPatchChange extends JsonObject {
  rowId: string;
  expectedVersion: number;
  label: string;
  amountCents: number;
  status: SheetRow['status'];
}
export interface SheetPatchInput extends JsonObject {
  actorId: string;
  changes: SheetPatchChange[];
  idempotencyKey: string;
}
export interface SheetImportInput extends JsonObject {
  actorId: string;
  rows: JsonObject[];
}
export interface SheetExportInput extends SheetFilterInput {
  idempotencyKey: string;
}
export interface SheetQueryResult extends JsonObject {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: JsonObject[];
}
export interface SheetPatchResult extends JsonObject {
  rows: JsonObject[];
}
export interface SheetExportResult extends JsonObject {
  assetId: string;
  filename: string;
  rowCount: number;
  mimeType: string;
}

function errorsForActor(state: DemoState, actorId: string): AwcpFieldError[] {
  return state.employees.some((item) => item.id === actorId && item.active)
    ? []
    : [fieldError(['actorId'], '操作人不存在或已离职。')];
}

function filterErrors(state: DemoState, input: SheetFilterInput): AwcpFieldError[] {
  const errors = errorsForActor(state, input.actorId);
  if (typeof input.keyword !== 'string' || input.keyword.length > 120)
    errors.push(fieldError(['keyword'], '关键词最多 120 字。'));
  if (input.departmentId !== null && !state.departments.some((item) => item.id === input.departmentId))
    errors.push(fieldError(['departmentId'], '部门不存在。'));
  if (input.status !== null && input.status !== 'draft' && input.status !== 'confirmed')
    errors.push(fieldError(['status'], '状态无效。'));
  if (input.minAmountCents !== null && (!Number.isSafeInteger(input.minAmountCents) || input.minAmountCents < 0))
    errors.push(fieldError(['minAmountCents'], '最低金额必须是非负整数分。'));
  if (input.sortBy !== 'id' && input.sortBy !== 'amountCents') errors.push(fieldError(['sortBy'], '排序字段无效。'));
  if (input.sortDirection !== 'asc' && input.sortDirection !== 'desc')
    errors.push(fieldError(['sortDirection'], '排序方向无效。'));
  return errors;
}

function filtered(state: DemoState, input: SheetFilterInput): SheetRow[] {
  const keyword = input.keyword.trim().toLocaleLowerCase();
  const direction = input.sortDirection === 'asc' ? 1 : -1;
  return state.sheetRows
    .filter(
      (row) =>
        (!keyword || `${row.id} ${row.label}`.toLocaleLowerCase().includes(keyword)) &&
        (input.departmentId === null || row.departmentId === input.departmentId) &&
        (input.status === null || row.status === input.status) &&
        (input.minAmountCents === null || row.amountCents >= input.minAmountCents)
    )
    .sort((left, right) => {
      const primary =
        input.sortBy === 'amountCents' ? left.amountCents - right.amountCents : left.id.localeCompare(right.id);
      return primary * direction || left.id.localeCompare(right.id);
    });
}

function assertValid(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-sheet-input',
      '表格参数校验失败。',
      errors.map((error) => ({ path: error.path, messages: error.messages }))
    );
}

function keyErrors(key: string): AwcpFieldError[] {
  return typeof key === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(key)
    ? []
    : [fieldError(['idempotencyKey'], '幂等键格式无效。')];
}

function patchFingerprint(input: SheetPatchInput): string {
  return JSON.stringify({ actorId: input.actorId, changes: input.changes });
}

function exportFingerprint(input: SheetExportInput): string {
  return JSON.stringify({ ...input, idempotencyKey: undefined });
}

function rowValue(row: SheetRow): JsonObject {
  return {
    id: row.id,
    departmentId: row.departmentId,
    label: row.label,
    amountCents: row.amountCents,
    status: row.status,
    businessVersion: row.businessVersion
  };
}

function nextId(prefix: string, ids: string[]): string {
  const next = Math.max(0, ...ids.map((id) => Number(id.split('-')[1]) || 0)) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export class SheetService {
  constructor(private readonly repository: DemoRepository) {}

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  departments(): Array<{ id: string; name: string }> {
    return this.repository.snapshot().departments.map(({ id, name }) => ({ id, name }));
  }
  exportAsset(assetId: string): { filename: string; content: string; mimeType: string } | null {
    const asset = this.repository.snapshot().sheetExports.find((item) => item.assetId === assetId);
    return asset ? { filename: asset.filename, content: asset.content, mimeType: asset.mimeType } : null;
  }

  validateQuery(input: SheetQueryInput): AwcpFieldError[] {
    const errors = filterErrors(this.repository.snapshot(), input);
    if (!Number.isSafeInteger(input.page) || input.page < 1) errors.push(fieldError(['page'], '页码从 1 开始。'));
    if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 50)
      errors.push(fieldError(['pageSize'], '每页行数必须在 1 到 50 之间。'));
    return errors;
  }
  query(input: SheetQueryInput): SheetQueryResult {
    assertValid(this.validateQuery(input));
    const rows = filtered(this.repository.snapshot(), input);
    return {
      total: rows.length,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(rows.length / input.pageSize),
      items: rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map(rowValue)
    };
  }

  validatePatch(input: SheetPatchInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const state = this.repository.snapshot();
    const errors = [...errorsForActor(state, input.actorId), ...keyErrors(input.idempotencyKey)];
    const fingerprint = patchFingerprint(input);
    const previous = state.sheetPatchRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (previous)
      return previous.fingerprint === fingerprint ? [] : [fieldError(['idempotencyKey'], '幂等键已用于其他批量修改。')];
    if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 50) {
      errors.push(fieldError(['changes'], '一次须修改 1 到 50 行。'));
      return errors;
    }
    const seen = new Set<string>();
    input.changes.forEach((change, index) => {
      const path = (field: string) => ['changes', index, field];
      if (seen.has(change.rowId)) errors.push(fieldError(path('rowId'), '同一行不能重复提交。'));
      seen.add(change.rowId);
      const row = state.sheetRows.find((item) => item.id === change.rowId);
      if (!row) errors.push(fieldError(path('rowId'), '行不存在。'));
      else if (row.businessVersion !== change.expectedVersion)
        errors.push(fieldError(path('expectedVersion'), `行版本应为 ${row.businessVersion}。`));
      if (typeof change.label !== 'string' || !change.label.trim() || change.label.trim().length > 80)
        errors.push(fieldError(path('label'), '名称须为 1 到 80 字。'));
      if (!Number.isSafeInteger(change.amountCents) || change.amountCents < 0 || change.amountCents > 100_000_000)
        errors.push(fieldError(path('amountCents'), '金额须为 0 到 100000000 的整数分。'));
      if (change.status !== 'draft' && change.status !== 'confirmed')
        errors.push(fieldError(path('status'), '状态无效。'));
    });
    return errors;
  }
  patch(input: SheetPatchInput): SheetPatchResult {
    return this.repository.transact((state) => {
      const fingerprint = patchFingerprint(input);
      const previous = state.sheetPatchRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          assertValid([fieldError(['idempotencyKey'], '幂等键已用于其他批量修改。')]);
        return { rows: previous.rows.map(rowValue) };
      }
      assertValid(this.validatePatch(input));
      const rows = input.changes.map((change) => {
        const row = state.sheetRows.find((item) => item.id === change.rowId);
        if (!row) throw businessError('action.sheet-row-not-found', '行不存在。');
        row.label = change.label.trim();
        row.amountCents = change.amountCents;
        row.status = change.status;
        row.businessVersion += 1;
        state.auditEntries.push({
          id: nextId(
            'AUD',
            state.auditEntries.map((item) => item.id)
          ),
          entityType: 'sheet-row',
          entityId: row.id,
          action: 'rows.patch',
          actorId: input.actorId,
          at: this.repository.clock.now(),
          fromStatus: null,
          toStatus: row.status,
          businessVersion: row.businessVersion
        });
        return structuredClone(row);
      });
      state.sheetPatchRecords.push({ idempotencyKey: input.idempotencyKey, fingerprint, rows });
      return { rows: rows.map(rowValue) };
    });
  }

  validateImport(input: SheetImportInput): AwcpFieldError[] {
    const errors = errorsForActor(this.repository.snapshot(), input.actorId);
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 100)
      errors.push(fieldError(['rows'], '一次须校验 1 到 100 行。'));
    return errors;
  }
  checkImport(input: SheetImportInput): JsonObject {
    assertValid(this.validateImport(input));
    const state = this.repository.snapshot();
    const seen = new Set<string>();
    const errorRows: JsonObject[] = [];
    input.rows.forEach((row, index) => {
      const errors: JsonObject[] = [];
      if (typeof row.departmentId !== 'string' || !state.departments.some((item) => item.id === row.departmentId))
        errors.push({ field: 'departmentId', message: '部门不存在。' });
      if (typeof row.label !== 'string' || !row.label.trim() || row.label.trim().length > 80)
        errors.push({ field: 'label', message: '名称须为 1 到 80 字。' });
      else if (seen.has(row.label.trim())) errors.push({ field: 'label', message: '导入文件内名称重复。' });
      if (typeof row.label === 'string') seen.add(row.label.trim());
      if (
        !Number.isSafeInteger(row.amountCents) ||
        Number(row.amountCents) < 0 ||
        Number(row.amountCents) > 100_000_000
      )
        errors.push({ field: 'amountCents', message: '金额须为 0 到 100000000 的整数分。' });
      if (row.status !== 'draft' && row.status !== 'confirmed') errors.push({ field: 'status', message: '状态无效。' });
      if (errors.length) errorRows.push({ rowNumber: index + 1, errors });
    });
    return {
      rowCount: input.rows.length,
      validCount: input.rows.length - errorRows.length,
      errorRows,
      imported: false
    };
  }

  validateExport(input: SheetExportInput): AwcpFieldError[] {
    const state = this.repository.snapshot();
    const errors = [...filterErrors(state, input), ...keyErrors(input.idempotencyKey)];
    const previous = state.sheetExports.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (previous && previous.fingerprint !== exportFingerprint(input))
      errors.push(fieldError(['idempotencyKey'], '幂等键已用于其他导出。'));
    return errors;
  }
  export(input: SheetExportInput): SheetExportResult {
    return this.repository.transact((state) => {
      assertValid(this.validateExport(input));
      const previous = state.sheetExports.find((item) => item.idempotencyKey === input.idempotencyKey);
      if (previous)
        return {
          assetId: previous.assetId,
          filename: previous.filename,
          rowCount: previous.rowCount,
          mimeType: previous.mimeType
        };
      const rows = filtered(state, input);
      const assetId = nextId(
        'SHEETAST',
        state.sheetExports.map((item) => item.assetId)
      );
      const filename = `${assetId}.csv`;
      const content =
        [
          'id,departmentId,label,amountCents,status,businessVersion',
          ...rows.map((row) =>
            [row.id, row.departmentId, row.label, row.amountCents, row.status, row.businessVersion]
              .map(csvCell)
              .join(',')
          )
        ].join('\r\n') + '\r\n';
      state.sheetExports.push({
        assetId,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        fingerprint: exportFingerprint(input),
        filename,
        mimeType: 'text/csv',
        content,
        rowCount: rows.length,
        createdAt: this.repository.clock.now()
      });
      return { assetId, filename, rowCount: rows.length, mimeType: 'text/csv' };
    });
  }
}
