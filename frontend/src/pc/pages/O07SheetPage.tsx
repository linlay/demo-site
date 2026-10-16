import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  SHEET_EXPORT_SCHEMA,
  SHEET_IMPORT_SCHEMA,
  SHEET_PATCH_SCHEMA,
  SHEET_QUERY_SCHEMA
} from '../../common/awcp/sheetSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  SheetService,
  type SheetExportInput,
  type SheetImportInput,
  type SheetPatchInput,
  type SheetQueryInput
} from '../service/sheetService';
import styles from './O07SheetPage.module.css';

const FILTER = {
  actorId: 'EMP-004',
  keyword: '',
  departmentId: null,
  status: null,
  minAmountCents: null,
  sortBy: 'id',
  sortDirection: 'asc'
} as const;
const QUERY: SheetQueryInput = { ...FILTER, page: 1, pageSize: 3 };
const PATCH: SheetPatchInput = {
  actorId: 'EMP-004',
  changes: [
    { rowId: 'SROW-001', expectedVersion: 1, label: '虚构客户资料整理', amountCents: 12500, status: 'confirmed' },
    { rowId: 'SROW-005', expectedVersion: 1, label: '虚构行业数据整理', amountCents: 7500, status: 'confirmed' }
  ],
  idempotencyKey: 'o07-patch-example'
};
const IMPORT: SheetImportInput = {
  actorId: 'EMP-004',
  rows: [
    { departmentId: 'DEP-001', label: '虚构导入记录甲', amountCents: 5000, status: 'draft' },
    { departmentId: 'DEP-999', label: '', amountCents: -1, status: 'draft' }
  ]
};
const EXPORT: SheetExportInput = { ...FILTER, departmentId: 'DEP-001', idempotencyKey: 'o07-export-example' };

function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '使用虚构人员和表格行 ID；筛选参数完整填写。批量写入携带行版本及幂等键。',
    effects,
    result: '返回筛选总数与当前页、逐行校验错误或 CSV 资产 ID。',
    failures: '字段、行版本或幂等键冲突时返回可定位错误；批量编辑不部分写入。'
  });
}
function key(): string {
  return `o07-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O07SheetPage({ repository }: { repository: DemoRepository }): ReactElement {
  const [service] = useState(() => new SheetService(repository));
  const actorId = useCurrentActor('EMP-004');
  const [keyword, setKeyword] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [status, setStatus] = useState<'draft' | 'confirmed' | null>(null);
  const [minAmount, setMinAmount] = useState('');
  const [sortBy, setSortBy] = useState<'id' | 'amountCents'>('id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(3);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [patchAmount, setPatchAmount] = useState('');
  const [patchStatus, setPatchStatus] = useState<'draft' | 'confirmed' | ''>('');
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState('');
  const [exportId, setExportId] = useState('');
  const [message, setMessage] = useState('');
  const [, setRevision] = useState(0);
  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);

  const filter: SheetExportInput = {
    actorId,
    keyword,
    departmentId,
    status,
    minAmountCents:
      minAmount.trim() && Number.isSafeInteger(Number(minAmount)) && Number(minAmount) >= 0 ? Number(minAmount) : null,
    sortBy,
    sortDirection,
    idempotencyKey: ''
  };
  const query: SheetQueryInput = {
    actorId: filter.actorId,
    keyword: filter.keyword,
    departmentId: filter.departmentId,
    status: filter.status,
    minAmountCents: filter.minAmountCents,
    sortBy: filter.sortBy,
    sortDirection: filter.sortDirection,
    page,
    pageSize
  };
  const result = service.query(query);
  const visible = result.items as Array<{
    id: string;
    departmentId: string;
    label: string;
    amountCents: number;
    status: 'draft' | 'confirmed';
    businessVersion: number;
  }>;
  const exportAsset = exportId ? service.exportAsset(exportId) : null;

  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }

  const queryAction: AwcpActionRegistration<SheetQueryInput> = {
    action: 'office.sheet.query',
    title: '筛选与分页查询表格',
    description: guide(
      '按关键词、部门、状态、最低金额筛选并排序分页。',
      '有效人员和页码。',
      '只读；total 是筛选后总行数，items 是当前页。'
    ),
    inputSchema: SHEET_QUERY_SCHEMA,
    examples: [QUERY],
    validate: (args) => service.validateQuery(args),
    invoke: (args) => completed(service.query(args))
  };
  useAwcpAction(queryAction);
  const patchAction: AwcpActionRegistration<SheetPatchInput> = {
    action: 'office.sheet.rows.patch',
    title: '原子批量修改表格行',
    description: guide('一次修改多行名称、金额和状态。', '每行须存在且业务版本匹配。', '逐行校验后一次提交全部修改。'),
    inputSchema: SHEET_PATCH_SCHEMA,
    examples: [PATCH],
    validate: (args) => service.validatePatch(args),
    invoke: (args) => completed(service.patch(args))
  };
  useAwcpAction(patchAction);
  const importAction: AwcpActionRegistration<SheetImportInput> = {
    action: 'office.sheet.import.check',
    title: '校验表格导入行',
    description: guide('预检拟导入的结构化行并定位错误行。', '有效人员和 1 到 100 行。', '只校验，不写入表格。'),
    inputSchema: SHEET_IMPORT_SCHEMA,
    examples: [IMPORT],
    validate: (args) => service.validateImport(args),
    invoke: (args) => completed(service.checkImport(args))
  };
  useAwcpAction(importAction);
  const exportAction: AwcpActionRegistration<SheetExportInput> = {
    action: 'office.sheet.export.start',
    title: '导出筛选表格',
    description: guide(
      '将所有匹配筛选条件的行按当前排序保存为 CSV 快照。',
      '有效人员、筛选参数和幂等键。',
      '生成本地演示资产并返回 assetId。'
    ),
    inputSchema: SHEET_EXPORT_SCHEMA,
    examples: [EXPORT],
    validate: (args) => service.validateExport(args),
    invoke: (args) => completed(service.export(args))
  };
  useAwcpAction(exportAction);

  return (
    <section className={styles.page} aria-label="表格与数据处理">


      <p>筛选排序分页、原子批量编辑、导入预检和 CSV 导出。</p>
      <div className={styles.panel}>
        <h2>筛选与分页</h2>
        <div className={styles.grid}>
          <label htmlFor="o07-keyword">关键词</label>
          <input
            id="o07-keyword"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
              setPage(1);
            }}
          />
          <label htmlFor="o07-department">部门</label>
          <select
            id="o07-department"
            value={departmentId ?? ''}
            onChange={(event) => {
              setDepartmentId(event.target.value || null);
              setPage(1);
            }}
          >
            <option value="">全部部门</option>
            {service.departments().map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label htmlFor="o07-status">状态</label>
          <select
            id="o07-status"
            value={status ?? ''}
            onChange={(event) => {
              setStatus((event.target.value || null) as typeof status);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="confirmed">已确认</option>
          </select>
          <label htmlFor="o07-min">最低金额（分）</label>
          <input
            id="o07-min"
            type="number"
            min="0"
            value={minAmount}
            onChange={(event) => {
              setMinAmount(event.target.value);
              setPage(1);
            }}
          />
          <label htmlFor="o07-sort">排序</label>
          <select
            id="o07-sort"
            value={`${sortBy}:${sortDirection}`}
            onChange={(event) => {
              const [field, direction] = event.target.value.split(':');
              setSortBy(field as typeof sortBy);
              setSortDirection(direction as typeof sortDirection);
              setPage(1);
            }}
          >
            <option value="id:asc">ID 升序</option>
            <option value="id:desc">ID 降序</option>
            <option value="amountCents:asc">金额升序</option>
            <option value="amountCents:desc">金额降序</option>
          </select>
          <label htmlFor="o07-page-size">每页</label>
          <select
            id="o07-page-size"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            <option value={2}>2 行</option>
            <option value={3}>3 行</option>
            <option value={5}>5 行</option>
          </select>
        </div>
        <p>
          筛选后共 {result.total} 行；第 {result.page} 页 / 共 {result.totalPages} 页；当前页 {visible.length} 行。
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>选择</th>
              <th>ID</th>
              <th>部门</th>
              <th>名称</th>
              <th>金额（分）</th>
              <th>状态</th>
              <th>版本</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${row.id}`}
                    checked={selectedIds.includes(row.id)}
                    onChange={(event) =>
                      setSelectedIds((ids) =>
                        event.target.checked ? [...ids, row.id] : ids.filter((id) => id !== row.id)
                      )
                    }
                  />
                </td>
                <td>{row.id}</td>
                <td>{row.departmentId}</td>
                <td>{row.label}</td>
                <td>{row.amountCents}</td>
                <td>{row.status}</td>
                <td>{row.businessVersion}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.actions}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <button type="button" disabled={page >= result.totalPages} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </div>
      </div>
      <div className={styles.panel}>
        <h2>批量编辑</h2>
        <p>勾选当前页行，设置共同金额和状态；每行名称保持原值。全部校验通过后一起写入。</p>
        <div className={styles.grid}>


          <label htmlFor="o07-patch-amount">新金额（分）</label>
          <input
            id="o07-patch-amount"
            type="number"
            min="0"
            value={patchAmount}
            onChange={(event) => setPatchAmount(event.target.value)}
          />
          <label htmlFor="o07-patch-status">新状态</label>
          <select
            id="o07-patch-status"
            value={patchStatus}
            onChange={(event) => setPatchStatus(event.target.value as typeof patchStatus)}
          >
            <option value="">请选择状态</option>
            <option value="draft">草稿</option>
            <option value="confirmed">已确认</option>
          </select>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!selectedIds.length || !patchAmount.trim() || !patchStatus}
            onClick={() =>
              run(() => {
                if (!patchAmount.trim()) throw new Error('请填写新金额。');
                const state = repository.snapshot();
                const changes = selectedIds.map((id) => {
                  const row = state.sheetRows.find((item) => item.id === id);
                  if (!row) throw new Error(`所选行 ${id} 已不存在。`);
                  return {
                    rowId: row.id,
                    expectedVersion: row.businessVersion,
                    label: row.label,
                    amountCents: Number(patchAmount),
                    status: patchStatus as 'draft' | 'confirmed'
                  };
                });
                const result = service.patch({ actorId, changes, idempotencyKey: key() });
                setSelectedIds([]);
                return `已原子更新 ${result.rows.length} 行。`;
              })
            }
          >
            保存所选行
          </button>
        </div>
      </div>
      <div className={styles.panel}>
        <h2>导入预检与导出</h2>
        <label htmlFor="o07-import">拟导入行 JSON</label>
        <textarea id="o07-import" rows={8} value={importText} onChange={(event) => setImportText(event.target.value)} />
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!importText.trim()}
            onClick={() =>
              run(() => {
                const rows: unknown = JSON.parse(importText);
                if (!Array.isArray(rows)) throw new Error('导入内容必须是行数组。');
                const check = service.checkImport({ actorId, rows });
                setImportResult(JSON.stringify(check, null, 2));
                return `已校验 ${String(check.rowCount)} 行，未写入。`;
              })
            }
          >
            校验导入
          </button>
          <button
            type="button"
            onClick={() =>
              run(() => {
                const exported = service.export({ ...filter, idempotencyKey: key() });
                setExportId(exported.assetId);
                return `已生成 ${exported.assetId}，共 ${exported.rowCount} 行。`;
              })
            }
          >
            导出当前筛选
          </button>
        </div>
        {importResult && <pre aria-label="导入校验结果">{importResult}</pre>}
        {exportAsset && (
          <p>
            导出资产 {exportId}：
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(exportAsset.content)}`}
              download={exportAsset.filename}
            >
              下载 CSV
            </a>
          </p>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
