import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  DIRECTORY_QUERY_SCHEMA,
  GROUP_READ_SCHEMA,
  GROUP_SAVE_SCHEMA,
  TEAM_READ_SCHEMA,
  TEAM_REPLACE_SCHEMA
} from '../../common/awcp/directorySchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  DirectoryService,
  type DirectoryQueryInput,
  type GroupReadInput,
  type GroupSaveInput,
  type MembershipView,
  type TeamReadInput,
  type TeamReplaceInput
} from '../service/directoryService';
import styles from './O02DirectoryPage.module.css';

const QUERY: DirectoryQueryInput = { actorId: 'EMP-008', departmentId: 'DEP-002', name: '' };
const TEAM_READ: TeamReadInput = { teamId: 'TEAM-001', actorId: 'EMP-008' };
const GROUP_READ: GroupReadInput = { groupId: 'CGROUP-001', actorId: 'EMP-008' };
const TEAM_REPLACE: TeamReplaceInput = {
  ...TEAM_READ,
  expectedVersion: 1,
  memberIds: ['EMP-003', 'EMP-004'],
  idempotencyKey: 'o02-team-example'
};
const GROUP_SAVE: GroupSaveInput = {
  ...GROUP_READ,
  expectedVersion: 1,
  memberIds: ['EMP-003', 'EMP-004'],
  idempotencyKey: 'o02-group-example'
};

function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '提供当前人员、对象 ID；修改时附成员 ID、对象版本和稳定业务幂等键。',
    effects,
    result: '返回员工或成员集合与当前版本。',
    failures: '人员、成员、角色、版本或幂等键不符时返回字段错误，不写入。'
  });
}
function key(): string {
  return `o02-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function available(read: () => MembershipView): MembershipView | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export default function O02DirectoryPage({ repository }: { repository: DemoRepository }): ReactElement {
  const [service] = useState(() => new DirectoryService(repository));
  const actorId = useCurrentActor('EMP-008');
  const [departmentId, setDepartmentId] = useState('');
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>(['EMP-003', 'EMP-009']);
  const [message, setMessage] = useState('');
  const [, setRevision] = useState(0);
  const keys = useRef(new Map<string, string>());
  const team = available(() => service.readTeam({ teamId: 'TEAM-001', actorId }));
  const group = available(() => service.readGroup({ groupId: 'CGROUP-001', actorId }));
  const employees = service.query({ actorId, departmentId, name }).employees;
  const actors = service.actors();

  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  function intentKey(scope: string, version: number): string {
    const intent = `${scope}:${actorId}:${version}:${memberIds.join(',')}`;
    let result = keys.current.get(intent);
    if (!result) {
      result = key();
      keys.current.set(intent, result);
    }
    return result;
  }
  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  function toggleMember(id: string): void {
    setMemberIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  const queryAction: AwcpActionRegistration<DirectoryQueryInput> = {
    action: 'office.directory.query',
    title: '查询跨部门联系人',
    description: guide('按部门和姓名查询有效员工 ID。', '当前人员处于启用状态。', '只读，不返回离职人员。'),
    inputSchema: DIRECTORY_QUERY_SCHEMA,
    examples: [QUERY],
    validate: (args) => service.validateQuery(args),
    invoke: (args) => completed(service.query(args))
  };
  useAwcpAction(queryAction);
  const teamReadAction: AwcpActionRegistration<TeamReadInput> = {
    action: 'office.team.read',
    title: '读取协作组',
    description: guide('读取项目协作组成员及业务版本。', '当前人员为负责人或成员。', '只读。'),
    inputSchema: TEAM_READ_SCHEMA,
    examples: [TEAM_READ],
    validate: (args) => service.validateReadTeam(args),
    invoke: (args) => completed(service.readTeam(args))
  };
  useAwcpAction(teamReadAction);
  const replaceAction: AwcpActionRegistration<TeamReplaceInput> = {
    action: 'office.team.replace',
    title: '替换协作人员',
    description: guide('替换固定项目协作组成员。', '负责人提供所有目标成员与当前版本。', '原子更新成员、版本和审计。'),
    inputSchema: TEAM_REPLACE_SCHEMA,
    examples: [TEAM_REPLACE],
    validate: (args) => service.validateReplaceTeam(args),
    invoke: (args) => completed(service.replaceTeam(args))
  };
  useAwcpAction(replaceAction);
  const groupReadAction: AwcpActionRegistration<GroupReadInput> = {
    action: 'office.group.read',
    title: '读取通讯分组',
    description: guide('读取通讯分组成员及业务版本。', '当前人员为负责人或成员。', '只读。'),
    inputSchema: GROUP_READ_SCHEMA,
    examples: [GROUP_READ],
    validate: (args) => service.validateReadGroup(args),
    invoke: (args) => completed(service.readGroup(args))
  };
  useAwcpAction(groupReadAction);
  const saveAction: AwcpActionRegistration<GroupSaveInput> = {
    action: 'office.group.save',
    title: '维护通讯分组',
    description: guide(
      '增删固定通讯分组成员。',
      '负责人提供全部目标成员与当前版本。',
      '原子保存成员、版本和审计；重复成员被拒绝。'
    ),
    inputSchema: GROUP_SAVE_SCHEMA,
    examples: [GROUP_SAVE],
    validate: (args) => service.validateSaveGroup(args),
    invoke: (args) => completed(service.saveGroup(args))
  };
  useAwcpAction(saveAction);

  return (
    <section className={styles.page} aria-label="人员与组织">


      <p>查询跨部门联系人，选择协作人员，并维护通讯分组。</p>
      <div className={styles.controls}>


        <label htmlFor="o02-department">部门筛选</label>
        <select id="o02-department" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
          <option value="">全部</option>
          {service.departments().map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <label htmlFor="o02-name">姓名筛选</label>
        <input id="o02-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <button
        type="button"
        onClick={() =>
          run(() => `查询到 ${service.query({ actorId, departmentId, name }).employees.length} 位联系人。`)
        }
      >
        查找联系人
      </button>
      <ul aria-label="联系人结果">
        {employees.map((item) => (
          <li key={String(item.id)}>
            {String(item.id)} · {String(item.name)} · {String(item.departmentName)}
          </li>
        ))}
      </ul>
      <fieldset className={styles.members}>
        <legend>目标成员</legend>
        {actors.map((item) => (
          <label key={item.id}>
            <input type="checkbox" checked={memberIds.includes(item.id)} onChange={() => toggleMember(item.id)} />
            {item.name}（{item.id}）
          </label>
        ))}
      </fieldset>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={!team || team.ownerId !== actorId}
          onClick={() =>
            run(
              () =>
                `协作组版本 ${service.replaceTeam({ teamId: 'TEAM-001', actorId, expectedVersion: team?.businessVersion ?? 0, memberIds, idempotencyKey: intentKey('team', team?.businessVersion ?? 0) }).businessVersion}。`
            )
          }
        >
          替换协作人员
        </button>
        <button
          type="button"
          disabled={!group || group.ownerId !== actorId}
          onClick={() =>
            run(
              () =>
                `通讯分组版本 ${service.saveGroup({ groupId: 'CGROUP-001', actorId, expectedVersion: group?.businessVersion ?? 0, memberIds, idempotencyKey: intentKey('group', group?.businessVersion ?? 0) }).businessVersion}。`
            )
          }
        >
          保存通讯分组
        </button>
      </div>
      <p role="status">{message}</p>
      <div className={styles.summary} aria-label="成员集合">
        <p>协作组：{team ? `${team.memberIds.join('、')} · 版本 ${team.businessVersion}` : '无权查看'}</p>
        <p>通讯分组：{group ? `${group.memberIds.join('、')} · 版本 ${group.businessVersion}` : '无权查看'}</p>
      </div>
    </section>
  );
}
