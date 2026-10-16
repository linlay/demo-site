import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  IT_READ_SCHEMA,
  TICKET_ASSIGN_SCHEMA,
  TICKET_CLOSE_SCHEMA,
  TICKET_RESOLVE_SCHEMA
} from '../../common/awcp/itSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  ItService,
  type ItReadInput,
  type TicketAssignInput,
  type TicketCloseInput,
  type TicketResolveInput
} from '../service/itService';
import styles from './O15ItPage.module.css';

const ASSIGN: TicketAssignInput = {
  actorId: 'EMP-004',
  ticketId: 'TKT-001',
  assigneeId: 'EMP-006',
  expectedVersion: 1,
  idempotencyKey: 'o15-assign-example'
};
const RESOLVE: TicketResolveInput = {
  actorId: 'EMP-006',
  ticketId: 'TKT-002',
  resolution: '已检查虚构打印服务并恢复。',
  expectedVersion: 2,
  idempotencyKey: 'o15-resolve-example'
};
const CLOSE: TicketCloseInput = {
  actorId: 'EMP-001',
  ticketId: 'TKT-003',
  acceptanceNote: '演示工作站功能已验证。',
  expectedVersion: 3,
  idempotencyKey: 'o15-close-example'
};
function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '使用页面列出的系统、权限、资料或工单 ID；写入时带业务幂等键，工单写入须带当前版本。',
    effects,
    result: '返回申请或工单 ID、状态和业务版本；查询返回目录、资料、申请、工单及完整事件。',
    failures: '角色、资料、状态、版本和幂等键不合法时返回字段错误，记录不变。'
  });
}
function key(): string {
  return `o15-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O15ItPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new ItService(repository));
  const [, setRevision] = useState(0);
  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const actorId = useCurrentActor('EMP-001');
  const [ticketId, setTicketId] = useState(objectId ?? 'TKT-001');
  const [assigneeId, setAssigneeId] = useState('EMP-006');
  const [resolution, setResolution] = useState('');
  const [acceptanceNote, setAcceptanceNote] = useState('');
  const [message, setMessage] = useState('');
  const state = service.snapshot();
  const ticket = state.itTickets.find((item) => item.id === ticketId);
  const readAction: AwcpActionRegistration<ItReadInput> = {
    action: 'office.it.read',
    title: '查询 IT 系统权限与工单',
    description: guide('查可用系统、权限 ID、申请资料与工单历史。', '在职员工。', '只读。'),
    inputSchema: IT_READ_SCHEMA,
    examples: [{ actorId: 'EMP-001' }],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const assignAction: AwcpActionRegistration<TicketAssignInput> = {
    action: 'office.ticket.assign',
    title: '分派 IT 工单',
    description: guide(
      '将新工单分派给在职 IT 处理员。',
      '由 IT 协调员操作，新工单且版本一致。',
      '状态改为 assigned，记录完整分派事件。'
    ),
    inputSchema: TICKET_ASSIGN_SCHEMA,
    examples: [ASSIGN],
    validate: (args) => service.validateAssign(args),
    invoke: (args) => completed(service.assign(args))
  };
  useAwcpAction(assignAction);
  const resolveAction: AwcpActionRegistration<TicketResolveInput> = {
    action: 'office.ticket.resolve',
    title: '处理 IT 工单',
    description: guide(
      '登记已分派工单的处理结果。',
      '指定处理人、assigned 状态、非空处理意见和当前版本。',
      '状态改为 resolved，留下处理事件。'
    ),
    inputSchema: TICKET_RESOLVE_SCHEMA,
    examples: [RESOLVE],
    validate: (args) => service.validateResolve(args),
    invoke: (args) => completed(service.resolve(args))
  };
  useAwcpAction(resolveAction);
  const closeAction: AwcpActionRegistration<TicketCloseInput> = {
    action: 'office.ticket.close',
    title: '验收关闭 IT 工单',
    description: guide(
      '由报单人验收处理结果并关闭。',
      '工单已分派、已记录处理结果并处于 resolved 状态。',
      '保存验收意见、关闭时间与事件；相同键重放返回既有结果。'
    ),
    inputSchema: TICKET_CLOSE_SCHEMA,
    examples: [CLOSE],
    validate: (args) => service.validateClose(args),
    invoke: (args) => completed(service.close(args))
  };
  useAwcpAction(closeAction);
  function run(task: () => { id: string; status: string }): void {
    try {
      const result = task();
      setMessage(`${result.id}：${result.status}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  return (
    <main className={styles.page}>

      <section>
        <h2>IT 工单</h2>
        <label>
          工单{' '}
          <select aria-label="工单" value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
            {state.itTickets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} {item.title}（{item.status}）
              </option>
            ))}
          </select>
        </label>
        <p>
          状态 {ticket?.status}；报单人 {ticket?.requesterId}；处理人 {ticket?.assigneeId ?? '未分派'}；版本{' '}
          {ticket?.businessVersion}。
        </p>
        <label>
          处理人{' '}
          <select aria-label="处理人" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            {state.employees
              .filter((item) => item.active && item.roles.includes('it-agent'))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} {item.name}
                </option>
              ))}
          </select>
        </label>
        <button
          onClick={() =>
            run(() =>
              service.assign({
                actorId,
                ticketId,
                assigneeId,
                expectedVersion: ticket?.businessVersion ?? 0,
                idempotencyKey: key()
              })
            )
          }
        >
          分派工单
        </button>
        <label>
          处理意见 <input aria-label="处理意见" value={resolution} onChange={(e) => setResolution(e.target.value)} />
        </label>
        <button
          onClick={() =>
            run(() =>
              service.resolve({
                actorId,
                ticketId,
                resolution,
                expectedVersion: ticket?.businessVersion ?? 0,
                idempotencyKey: key()
              })
            )
          }
        >
          处理工单
        </button>
        <label>
          验收意见{' '}
          <input aria-label="验收意见" value={acceptanceNote} onChange={(e) => setAcceptanceNote(e.target.value)} />
        </label>
        <button
          onClick={() =>
            run(() =>
              service.close({
                actorId,
                ticketId,
                acceptanceNote,
                expectedVersion: ticket?.businessVersion ?? 0,
                idempotencyKey: key()
              })
            )
          }
        >
          验收关闭
        </button>
        <h3>处理历史</h3>
        <ol>
          {state.itTicketEvents
            .filter((item) => item.ticketId === ticketId)
            .map((item) => (
              <li key={item.id}>
                {item.id} {item.fromStatus} → {item.toStatus}；{item.actorId}；{item.note}
              </li>
            ))}
        </ol>
      </section>
      <p role="status">{message}</p>
    </main>
  );
}
