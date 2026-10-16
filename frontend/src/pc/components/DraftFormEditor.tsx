import { useCurrentActor } from '../../app/currentUserContext';
import { useAwcpAction } from '@app/awcp';
import type { AwcpActionRegistration } from '@app/awcp';
import { DataTree } from '@app/ui';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import type { DraftFormInput, DraftFormView, DraftFormService } from '../service/draftFormService';
import styles from './DraftFormEditor.module.css';

const SAVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['formId', 'actorId', 'applicantId', 'departmentId', 'amountCents', 'assetIds', 'expectedVersion'],
  properties: {
    formId: { type: 'string', pattern: '^FORM-[0-9]{3}$' },
    actorId: { type: 'string', pattern: '^EMP-[0-9]{3}$' },
    applicantId: { type: 'string', pattern: '^EMP-[0-9]{3}$' },
    departmentId: { type: 'string', pattern: '^DEP-[0-9]{3}$' },
    amountCents: { type: 'integer', minimum: 0 },
    assetIds: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^AST-[0-9]{3}$' } },
    expectedVersion: { type: 'integer', minimum: 1 }
  }
};

interface DraftFormEditorProps {
  service: DraftFormService;
  formId: string;
  actionId: string;
}

function inputFromView(view: DraftFormView): DraftFormInput {
  return {
    formId: view.form.id,
    actorId: view.form.applicantId,
    applicantId: view.form.applicantId,
    departmentId: view.form.departmentId,
    amountCents: view.form.amountCents,
    assetIds: view.assetIds,
    expectedVersion: view.form.businessVersion
  };
}

export function DraftFormEditor({ service, formId, actionId }: DraftFormEditorProps): ReactElement {
  const [view, setView] = useState(() => service.read(formId));
  const actorId = useCurrentActor(view.form.applicantId);
  const [input, setInput] = useState(() => inputFromView(view));
  const [message, setMessage] = useState('');

  useEffect(() => {
    const update = () => {
      const next = service.read(formId);
      setView(next);
      setInput(inputFromView(next));
    };
    update();
    return service.subscribe(update);
  }, [formId, service]);

  const registration: AwcpActionRegistration<DraftFormInput> | null =
    view.form.status === 'draft'
      ? {
          action: actionId,
          title: '保存演示申请草稿',
          description: describeAction({
            purpose: '更新当前演示申请草稿与附件关联。',
            prerequisites: `${formId} 存在且为草稿；actorId 是原申请人。`,
            parameters: '金额单位为分；assetIds 仅可使用页面列出的未关联或本单据附件；expectedVersion 为当前业务版本。',
            effects: '原子更新草稿字段、附件归属并递增业务版本。',
            result: '返回 completed、单据 ID、业务版本和附件 ID。',
            failures: '无效 ID、非草稿或版本冲突不会写入；刷新后重试。'
          }),
          inputSchema: SAVE_SCHEMA,
          examples: [inputFromView(view)],
          validate: (args) => service.validate(args),
          invoke: (args) => completed(service.save(args))
        }
      : null;
  useAwcpAction(registration);

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    try {
      const result = service.save({ ...input, actorId });
      setMessage(`已保存 ${result.formId}，业务版本 ${result.businessVersion}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    }
  }

  return (
    <form className={styles.form} onSubmit={save} aria-label="演示申请草稿">
      <h2>申请草稿 {view.form.id}</h2>
      <p>
        当前状态：{view.form.status} · 业务版本：{view.form.businessVersion}
      </p>
      <label htmlFor="draft-amount">金额（分）</label>
      <input
        id="draft-amount"
        type="number"
        min="0"
        step="1"
        value={input.amountCents}
        onChange={(event) => setInput((current) => ({ ...current, amountCents: Number(event.target.value) }))}
        disabled={view.form.status !== 'draft'}
      />
      <p>申请人：{view.employees.find((item) => item.id === input.applicantId)?.name ?? input.applicantId}</p>
      <p>部门：{view.departments.find((item) => item.id === input.departmentId)?.name ?? input.departmentId}</p>
      <div className={styles.tree} aria-label="组织与人员选择">
        <h3>选择申请人</h3>
        <DataTree
          data={service.organizationTree()}
          selectedKey={input.applicantId}
          expandAll
          isVirtual={false}
          onSelect={(key) => {
            const employee = view.employees.find((item) => item.id === key);
            if (employee) {
              setInput((current) => ({
                ...current,
                applicantId: employee.id,
                departmentId: employee.departmentId
              }));
            }
          }}
        />
      </div>
      <fieldset>
        <legend>已有附件 assetId</legend>
        {view.availableAssets.map((attachment) => (
          <label key={attachment.assetId} className={styles.asset}>
            <input
              type="checkbox"
              checked={input.assetIds.includes(attachment.assetId)}
              disabled={view.form.status !== 'draft'}
              onChange={(event) => {
                setInput((current) => ({
                  ...current,
                  assetIds: event.target.checked
                    ? [...current.assetIds, attachment.assetId]
                    : current.assetIds.filter((item) => item !== attachment.assetId)
                }));
              }}
            />
            {attachment.filename}（{attachment.assetId}）
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={view.form.status !== 'draft'}>
        保存草稿
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
