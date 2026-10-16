import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  ADMIN_READ_SCHEMA,
  ASSET_ASSIGN_SCHEMA,
  ASSET_RETURN_SCHEMA,
  REPAIR_ACCEPT_SCHEMA,
  REPAIR_RESOLVE_SCHEMA
} from '../../common/awcp/adminSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  AdminService,
  type AdminReadInput,
  type AssetAssignInput,
  type AssetReturnInput,
  type RepairAcceptInput,
  type RepairResolveInput
} from '../service/adminService';
import styles from './O13AdminPage.module.css';

const READ: AdminReadInput = { actorId: 'EMP-001' };
const ASSIGN: AssetAssignInput = {
  actorId: 'EMP-002',
  assetId: 'EQ-001',
  holderId: 'EMP-003',
  expectedVersion: 1,
  idempotencyKey: 'o13-assign-example'
};
const RETURN: AssetReturnInput = {
  actorId: 'EMP-003',
  assetId: 'EQ-002',
  expectedVersion: 2,
  idempotencyKey: 'o13-return-example'
};
const RESOLVE: RepairResolveInput = {
  actorId: 'EMP-004',
  ticketId: 'REP-001',
  resolution: '已更换虚构进纸组件并测试。',
  expectedVersion: 1,
  idempotencyKey: 'o13-resolve-example'
};
const ACCEPT: RepairAcceptInput = {
  actorId: 'EMP-001',
  ticketId: 'REP-002',
  expectedVersion: 2,
  idempotencyKey: 'o13-accept-example'
};
function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '提供虚构员工、设备、资源或工单 ID；写操作附稳定幂等键及需要的业务版本。',
    effects,
    result: '返回资源或工单编号、状态与版本；只读动作返回持有及预约记录。',
    failures: '占用、时段、人员、处理意见或版本不符时返回字段错误且不写入。'
  });
}
function key(): string {
  return `o13-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O13AdminPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new AdminService(repository));
  const [, setRevision] = useState(0);
  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const actorId = useCurrentActor('EMP-001');
  const [assetId, setAssetId] = useState(() => objectId?.startsWith('EQ-') ? objectId : repository.snapshot().repairTickets.find((item) => item.id === objectId)?.assetId ?? 'EQ-001');
  const [holderId, setHolderId] = useState('');
  const [ticketId, setTicketId] = useState(() => objectId?.startsWith('REP-') ? objectId : 'REP-001');
  const [resolution, setResolution] = useState('');
  const [message, setMessage] = useState('');
  const state = service.snapshot();
  const asset = state.adminAssets.find((item) => item.id === assetId);
  const ticket = state.repairTickets.find((item) => item.id === ticketId);
  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  const readAction: AwcpActionRegistration<AdminReadInput> = {
    action: 'office.admin.read',
    title: '查询资产与行政资源',
    description: guide('查看设备持有人、预约记录和维修状态。', '在职员工。', '只读。'),
    inputSchema: ADMIN_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const assignAction: AwcpActionRegistration<AssetAssignInput> = {
    action: 'office.asset.assign',
    title: '分配设备',
    description: guide(
      '将可用设备分配给在职员工。',
      '资产管理员、空闲设备和当前版本。',
      '设备状态与持有人同步，并记录领用历史。'
    ),
    inputSchema: ASSET_ASSIGN_SCHEMA,
    examples: [ASSIGN],
    validate: (args) => service.validateAssign(args),
    invoke: (args) => completed(service.assign(args))
  };
  useAwcpAction(assignAction);
  const returnAction: AwcpActionRegistration<AssetReturnInput> = {
    action: 'office.asset.return',
    title: '归还设备',
    description: guide('归还已分配设备。', '当前持有人或资产管理员、当前版本。', '清空持有人并归档归还历史。'),
    inputSchema: ASSET_RETURN_SCHEMA,
    examples: [RETURN],
    validate: (args) => service.validateReturn(args),
    invoke: (args) => completed(service.returnAsset(args))
  };
  useAwcpAction(returnAction);
  const resolveAction: AwcpActionRegistration<RepairResolveInput> = {
    action: 'office.repair.resolve',
    title: '登记维修处理',
    description: guide(
      '处理待修设备工单并记录具体意见。',
      '指定维修人、待处理工单及当前版本。',
      '转为待验收，设备仍为维修状态。'
    ),
    inputSchema: REPAIR_RESOLVE_SCHEMA,
    examples: [RESOLVE],
    validate: (args) => service.validateResolve(args),
    invoke: (args) => completed(service.resolve(args))
  };
  useAwcpAction(resolveAction);
  const acceptAction: AwcpActionRegistration<RepairAcceptInput> = {
    action: 'office.repair.accept',
    title: '验收维修结果',
    description: guide(
      '由报修人验收已处理工单。',
      '已登记非空处理意见且工单处于待验收状态。',
      '关闭工单并恢复设备可用。'
    ),
    inputSchema: REPAIR_ACCEPT_SCHEMA,
    examples: [ACCEPT],
    validate: (args) => service.validateAccept(args),
    invoke: (args) => completed(service.accept(args))
  };
  useAwcpAction(acceptAction);

  return (
    <main className={styles.page}>

      <section>
        <h2>设备领用与归还</h2>
        <label>
          设备{' '}
          <select id="o13-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {state.adminAssets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} {item.name}（{item.status}）
              </option>
            ))}
          </select>
        </label>
        <p>
          状态 {asset?.status}；持有人 {asset?.holderId ?? '无'}；版本 {asset?.businessVersion}。
        </p>
        <label>
          领用人{' '}
          <select id="o13-holder" value={holderId} onChange={(e) => setHolderId(e.target.value)}>
            <option value="">请选择</option>
            {state.employees
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} {item.name}
                </option>
              ))}
          </select>
        </label>
        <button
          disabled={!asset || !holderId}
          onClick={() =>
            run(() => {
              const result = service.assign({
                actorId,
                assetId,
                holderId,
                expectedVersion: asset?.businessVersion ?? 0,
                idempotencyKey: key()
              });
              return `已领用 ${result.id}`;
            })
          }
        >
          分配设备
        </button>
        <button
          onClick={() =>
            run(() => {
              const result = service.returnAsset({
                actorId,
                assetId,
                expectedVersion: asset?.businessVersion ?? 0,
                idempotencyKey: key()
              });
              return `已归还 ${result.id}`;
            })
          }
        >
          归还设备
        </button>
        {state.assetMovements
          .filter((item) => item.assetId === assetId)
          .map((item) => (
            <p key={item.id}>
              {item.id} {item.action} {item.holderId}，经办人 {item.actorId}
            </p>
          ))}
      </section>
      <section>
        <h2>维修工单</h2>
        <label>
          工单{' '}
          <select id="o13-ticket" value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
            {state.repairTickets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} {item.issue}（{item.status}）
              </option>
            ))}
          </select>
        </label>
        <p>
          关联设备 {ticket?.assetId}；报修人 {ticket?.reporterId}；处理人 {ticket?.assigneeId}；状态 {ticket?.status}
          ；版本 {ticket?.businessVersion}。
        </p>
        <label>
          处理意见{' '}
          <input aria-label="维修处理意见" value={resolution} onChange={(e) => setResolution(e.target.value)} />
        </label>
        <button
          disabled={!ticket || !resolution.trim()}
          onClick={() =>
            run(() => {
              const result = service.resolve({
                actorId,
                ticketId,
                resolution,
                expectedVersion: ticket?.businessVersion ?? 0,
                idempotencyKey: key()
              });
              return `已处理 ${result.id}`;
            })
          }
        >
          登记维修处理
        </button>
        <button
          onClick={() =>
            run(() => {
              const result = service.accept({
                actorId,
                ticketId,
                expectedVersion: ticket?.businessVersion ?? 0,
                idempotencyKey: key()
              });
              return `已验收 ${result.id}`;
            })
          }
        >
          验收维修
        </button>
        <p>已登记意见：{ticket?.resolution ?? '无'}。</p>
      </section>
      {message && <p role="status">{message}</p>}
    </main>
  );
}
