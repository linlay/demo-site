import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  NOTICE_MUTATION_SCHEMA,
  NOTICE_READ_SCHEMA,
  NOTICE_RECIPIENT_SCHEMA
} from '../../common/awcp/noticeSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  NoticeService,
  type NoticeMutationInput,
  type NoticeReadInput,
  type NoticeRecipientInput
} from '../service/noticeService';
import styles from './O03NoticePage.module.css';

const READ: NoticeReadInput = { noticeId: 'NTC-002', actorId: 'EMP-004' };
const RECIPIENTS: NoticeRecipientInput = {
  noticeId: 'NTC-001',
  actorId: 'EMP-004',
  expectedVersion: 1,
  departmentIds: ['DEP-002', 'DEP-003'],
  idempotencyKey: 'o03-recipients-example'
};
const PUBLISH: NoticeMutationInput = {
  noticeId: 'NTC-001',
  actorId: 'EMP-004',
  expectedVersion: 1,
  idempotencyKey: 'o03-publish-example'
};
const UNREAD: NoticeReadInput = { noticeId: 'NTC-002', actorId: 'EMP-004' };
const REMIND: NoticeMutationInput = {
  noticeId: 'NTC-002',
  actorId: 'EMP-004',
  expectedVersion: 2,
  idempotencyKey: 'o03-remind-example'
};

function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '提供通知、当前人员；写操作附业务版本及稳定幂等键。',
    effects,
    result: '返回通知状态、版本或发布、回执与模拟提醒记录。',
    failures: '角色、字段、接收部门、状态、版本不符时返回字段错误且不写入。'
  });
}
function key(): string {
  return `o03-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O03NoticePage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new NoticeService(repository));
  const actorId = useCurrentActor(() => repository.snapshot().notices.find((item) => item.id === objectId)?.authorId ?? 'EMP-004');
  const [selected, setSelected] = useState(objectId ?? 'NTC-001');
  const [departmentIds, setDepartmentIds] = useState<string[]>(['DEP-001']);
  const [message, setMessage] = useState('');
  const [, setRevision] = useState(0);
  const keys = useRef(new Map<string, string>());
  const items = service.list(actorId);
  const noticeId = items.some((item) => item.noticeId === selected) ? selected : (items[0]?.noticeId ?? '');
  const current = items.find((item) => item.noticeId === noticeId);
  const view = current ? service.read({ noticeId, actorId }) : null;
  const recipientScope = view?.recipientDepartmentIds.join(',') ?? '';

  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  useEffect(
    () => setDepartmentIds(recipientScope ? recipientScope.split(',') : []),
    [noticeId, view?.businessVersion, recipientScope]
  );
  function intentKey(operation: string, payload = ''): string {
    const intent = `${operation}:${noticeId}:${current?.businessVersion}:${actorId}:${payload}`;
    let value = keys.current.get(intent);
    if (!value) {
      value = key();
      keys.current.set(intent, value);
    }
    return value;
  }
  function base(operation: string, payload = ''): NoticeMutationInput {
    return {
      noticeId,
      actorId,
      expectedVersion: current?.businessVersion ?? 0,
      idempotencyKey: intentKey(operation, payload)
    };
  }
  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  function toggleDepartment(id: string): void {
    setDepartmentIds((currentIds) =>
      currentIds.includes(id) ? currentIds.filter((item) => item !== id) : [...currentIds, id]
    );
  }

  const readAction: AwcpActionRegistration<NoticeReadInput> = {
    action: 'office.notice.read',
    title: '读取通知记录',
    description: guide('读取通知、发布范围、阅读回执、提醒与审计。', '由原起草人读取现有通知。', '只读。'),
    inputSchema: NOTICE_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const recipientsAction: AwcpActionRegistration<NoticeRecipientInput> = {
    action: 'office.notice.recipients.replace',
    title: '设置接收部门',
    description: guide(
      '替换草稿的完整接收部门集合。',
      '原起草人操作草稿；部门 ID 均有效。',
      '原子保存接收范围、业务版本与审计。'
    ),
    inputSchema: NOTICE_RECIPIENT_SCHEMA,
    examples: [RECIPIENTS],
    validate: (args) => service.validateReplaceRecipients(args),
    invoke: (args) => completed(service.replaceRecipients(args))
  };
  useAwcpAction(recipientsAction);
  const publishAction: AwcpActionRegistration<NoticeMutationInput> = {
    action: 'office.notice.publish',
    title: '模拟发布通知',
    description: guide(
      '将完整草稿模拟发布。',
      '有标题、正文、有效接收部门及至少一名有效员工；NTC-001 初始满足。',
      '生成唯一发布记录和接收回执，冻结接收范围。'
    ),
    inputSchema: NOTICE_MUTATION_SCHEMA,
    examples: [PUBLISH],
    validate: (args) => service.validatePublish(args),
    invoke: (args) => completed(service.publish(args))
  };
  useAwcpAction(publishAction);
  const unreadAction: AwcpActionRegistration<NoticeReadInput> = {
    action: 'office.notice.unread',
    title: '查询未读接收人',
    description: guide(
      '由发布快照与阅读回执计算未读名单。',
      '由原起草人查看已发布通知；NTC-002 有两名未读。',
      '只读。'
    ),
    inputSchema: NOTICE_READ_SCHEMA,
    examples: [UNREAD],
    validate: (args) => service.validateUnread(args),
    invoke: (args) => completed(service.unread(args))
  };
  useAwcpAction(unreadAction);
  const remindAction: AwcpActionRegistration<NoticeMutationInput> = {
    action: 'office.notice.remind',
    title: '模拟提醒未读人员',
    description: guide(
      '给尚未提醒的未读接收人建立模拟消息。',
      '已发布通知存在未读且未提醒的回执；由原起草人操作。',
      '只写本地模拟消息、版本与审计，不连接真实消息服务。'
    ),
    inputSchema: NOTICE_MUTATION_SCHEMA,
    examples: [REMIND],
    validate: (args) => service.validateRemind(args),
    invoke: (args) => completed(service.remind(args))
  };
  useAwcpAction(remindAction);

  return (
    <section className={styles.page} aria-label="公告通知事项办理">
      <div className={styles.controls}>


        <label htmlFor="o03-notice">通知</label>
        <select
          id="o03-notice"
          value={noticeId}
          onChange={(event) => {
            setSelected(event.target.value);
            setMessage('');
          }}
        >
          {items.map((item) => (
            <option key={item.noticeId} value={item.noticeId}>
              {item.noticeId} · {item.title} · {item.status}
            </option>
          ))}
        </select>
      </div>
      <fieldset className={styles.departments}>
        <legend>接收部门</legend>
        {service.departments().map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={departmentIds.includes(item.id)}
              onChange={() => toggleDepartment(item.id)}
            />
            {item.name}（{item.id}）
          </label>
        ))}
      </fieldset>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={current?.status !== 'draft'}
          onClick={() =>
            run(
              () =>
                `接收部门版本 ${service.replaceRecipients({ ...base('recipients', departmentIds.join(',')), departmentIds }).businessVersion}。`
            )
          }
        >
          保存接收部门
        </button>
        <button
          type="button"
          disabled={current?.status !== 'draft'}
          onClick={() => run(() => `发布结果：${service.publish(base('publish')).status}。`)}
        >
          模拟发布
        </button>
        <button
          type="button"
          disabled={current?.status !== 'published'}
          onClick={() =>
            run(() => `未读人员：${service.unread({ noticeId, actorId }).employeeIds.join('、') || '无'}。`)
          }
        >
          查询未读
        </button>
        <button
          type="button"
          disabled={current?.status !== 'published'}
          onClick={() => run(() => `提醒结果：版本 ${service.remind(base('remind')).businessVersion}。`)}
        >
          模拟提醒
        </button>
      </div>
      <p role="status">{message}</p>
      {view && (
        <div className={styles.summary} aria-label="通知业务进度">
          <p>
            {view.noticeId} · {view.status} · 业务版本 {view.businessVersion}
          </p>
          <p>
            接收部门：{view.recipientDepartmentIds.join('、') || '未设置'}；发布记录：
            {view.publication ? String(view.publication.id) : '未发布'}
          </p>
          <p>
            阅读回执 {view.receipts.length} 条；未读 {view.receipts.filter((item) => item.readAt === null).length}{' '}
            人；模拟提醒 {view.reminders.length} 条。
          </p>
          <ol>
            {view.history.map((item, index) => (
              <li key={index}>
                {String(item.action)} · 版本 {String(item.businessVersion)} · {String(item.note ?? '')}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
