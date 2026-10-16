import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration, JsonObject } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  ARCHIVE_SAVE_SCHEMA,
  ARCHIVE_SEARCH_SCHEMA,
  REPORT_DETAILS_SCHEMA,
  REPORT_READ_SCHEMA
} from '../../common/awcp/reportSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  ReportArchiveService,
  type ArchiveSaveInput,
  type ArchiveSearchInput,
  type ReportDetailsInput,
  type ReportReadInput
} from '../service/reportArchiveService';
import styles from './O16ReportPage.module.css';

const READ: ReportReadInput = { actorId: 'EMP-004', jobId: 'RJOB-001' };
const DETAILS: ReportDetailsInput = { actorId: 'EMP-004', jobId: 'RJOB-001', page: 1, pageSize: 10 };
const SEARCH: ArchiveSearchInput = { actorId: 'EMP-004', archiveId: 'ARC-001', version: 1 };
const SAVE: ArchiveSaveInput = {
  actorId: 'EMP-004',
  reportId: 'RJOB-001',
  archiveId: null,
  expectedVersion: null,
  idempotencyKey: 'o16-save-example'
};
function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '提供在职操作人、部门与期间或报表/档案 ID；写入须带稳定幂等键，更新档案须带当前版本。',
    effects,
    result: '生成报表先返回 accepted 和任务 ID，完成后可读汇总与异常明细；归档返回档案 ID 和版本。',
    failures: '部门、期间、角色、分页、状态或版本无效时返回字段错误，记录不变。'
  });
}
function key(): string {
  return `o16-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O16ReportPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new ReportArchiveService(repository));
  const [, setRevision] = useState(0);
  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const actorId = useCurrentActor(() => repository.snapshot().officeReportJobs.find((item) => item.id === objectId)?.actorId ?? 'EMP-004');
  const [jobId, setJobId] = useState(objectId ?? 'RJOB-001');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [archiveId, setArchiveId] = useState('ARC-001');
  const [archiveVersion, setArchiveVersion] = useState(1);
  const [details, setDetails] = useState<JsonObject | null>(null);
  const [archive, setArchive] = useState<JsonObject | null>(null);
  const [message, setMessage] = useState('');
  const state = service.snapshot();
  const job = state.officeReportJobs.find((item) => item.id === jobId);
  const selectedArchive = state.officeArchives.find((item) => item.id === archiveId);
  function run(task: () => string): void {
    try {
      setMessage(task());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  const readAction: AwcpActionRegistration<ReportReadInput> = {
    action: 'office.report.read',
    title: '查询报表任务与汇总',
    description: guide('按任务 ID 查询受理或完成阶段及汇总。', '有权查看该部门报表的复核员或主管。', '只读。'),
    inputSchema: REPORT_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const detailsAction: AwcpActionRegistration<ReportDetailsInput> = {
    action: 'office.report.details.query',
    title: '钻取报表异常明细',
    description: guide(
      '分页读取已完成报表的异常快照。',
      '报表已完成、允许角色、合法页码和每页条数。',
      '使用汇总同一行快照，可追溯来源类型、ID 和版本。'
    ),
    inputSchema: REPORT_DETAILS_SCHEMA,
    examples: [DETAILS],
    validate: (args) => service.validateDetails(args),
    invoke: (args) => completed(service.details(args))
  };
  useAwcpAction(detailsAction);
  const searchAction: AwcpActionRegistration<ArchiveSearchInput> = {
    action: 'office.archive.search',
    title: '查询档案版本与操作历史',
    description: guide(
      '按档案 ID 和版本读取不可变快照及保存历史。',
      '在职档案所有者、存在的版本。',
      '只读；越权和错误版本拒绝。'
    ),
    inputSchema: ARCHIVE_SEARCH_SCHEMA,
    examples: [SEARCH],
    validate: (args) => service.validateSearch(args),
    invoke: (args) => completed(service.search(args))
  };
  useAwcpAction(searchAction);
  const saveAction: AwcpActionRegistration<ArchiveSaveInput> = {
    action: 'office.archive.save',
    title: '归档已完成报表',
    description: guide(
      '新建档案或携当前版本追加报表快照。',
      '已完成报表；新建时档案 ID 和预期版本为空，更新时须为所有者。',
      '保存不可变版本与逐次操作历史。'
    ),
    inputSchema: ARCHIVE_SAVE_SCHEMA,
    examples: [SAVE],
    validate: (args) => service.validateSave(args),
    invoke: (args) => completed(service.save(args))
  };
  useAwcpAction(saveAction);
  return (
    <main className={styles.page}>

      <section>
        <h2>报表任务</h2>
        <label>
          报表任务{' '}
          <select
            aria-label="报表任务"
            value={jobId}
            onChange={(e) => {
              setJobId(e.target.value);
              setDetails(null);
            }}
          >
            {state.officeReportJobs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} {item.departmentId}（{item.status}）
              </option>
            ))}
          </select>
        </label>
        <p>
          阶段：{job?.status ?? '不存在'}；条件：{job?.departmentId} / {job?.startDate} 至 {job?.endDate}
          ；单位：件；总数：{job?.totalCount ?? '待完成'}；异常：{job?.anomalyCount ?? '待完成'}。
        </p>
      </section>
      <section>
        <h2>异常明细</h2>
        <label>
          页码{' '}
          <input
            aria-label="页码"
            type="number"
            min={1}
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
          />
        </label>
        <label>
          每页{' '}
          <input
            aria-label="每页"
            type="number"
            min={1}
            max={20}
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          />
        </label>
        <button
          onClick={() =>
            run(() => {
              const result = service.details({ actorId, jobId, page, pageSize });
              setDetails(result);
              return `异常明细 ${String(result.totalCount)} 件`;
            })
          }
        >
          查询异常明细
        </button>
        <pre>{details ? JSON.stringify(details, null, 2) : '暂无查询结果'}</pre>
      </section>
      <section>
        <h2>归档与历史查询</h2>
        <label>
          档案 ID <input aria-label="档案 ID" value={archiveId} onChange={(e) => setArchiveId(e.target.value)} />
        </label>
        <label>
          版本{' '}
          <input
            aria-label="档案版本"
            type="number"
            min={1}
            value={archiveVersion}
            onChange={(e) => setArchiveVersion(Number(e.target.value))}
          />
        </label>
        <button
          onClick={() =>
            run(() => {
              const result = service.search({ actorId, archiveId, version: archiveVersion });
              setArchive(result);
              return `找到 ${archiveId} 版本 ${archiveVersion}`;
            })
          }
        >
          查询档案
        </button>
        <button
          onClick={() =>
            run(() => {
              const result = service.save({
                actorId,
                reportId: jobId,
                archiveId: null,
                expectedVersion: null,
                idempotencyKey: key()
              });
              setArchiveId(result.id);
              setArchiveVersion(result.businessVersion);
              return `${result.id}：版本 ${result.businessVersion}`;
            })
          }
        >
          新建档案
        </button>
        <button
          onClick={() =>
            run(() => {
              const result = service.save({
                actorId,
                reportId: jobId,
                archiveId,
                expectedVersion: selectedArchive?.currentVersion ?? null,
                idempotencyKey: key()
              });
              setArchiveVersion(result.businessVersion);
              return `${result.id}：版本 ${result.businessVersion}`;
            })
          }
        >
          保存新版本
        </button>
        <pre>{archive ? JSON.stringify(archive, null, 2) : '暂无档案查询结果'}</pre>
      </section>
      <p role="status">{message}</p>
    </main>
  );
}
