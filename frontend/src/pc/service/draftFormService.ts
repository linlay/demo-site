import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { Attachment, BusinessForm, DemoState, Department, Employee } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface DraftFormInput extends JsonObject {
  formId: string;
  actorId: string;
  applicantId: string;
  departmentId: string;
  amountCents: number;
  assetIds: string[];
  expectedVersion: number;
}

export interface DraftFormView {
  form: BusinessForm;
  assetIds: string[];
  availableAssets: Attachment[];
  employees: Employee[];
  departments: Department[];
}

export interface FormTableRow extends JsonObject {
  id: string;
  kind: string;
  status: string;
  applicant: string;
  department: string;
  amountCents: number;
  businessVersion: number;
}

export interface OrganizationNode {
  id: string;
  label: string;
  children?: OrganizationNode[];
}

export class DraftFormService {
  constructor(private readonly repository: DemoRepository) {}

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }

  read(formId: string): DraftFormView {
    const state = this.repository.snapshot();
    const form = state.forms.find((item) => item.id === formId);
    if (!form) throw businessError('action.form-not-found', '申请单不存在。');
    return {
      form,
      assetIds: state.attachments.filter((item) => item.ownerId === formId).map((item) => item.assetId),
      availableAssets: state.attachments.filter((item) => item.ownerId === '' || item.ownerId === formId),
      employees: state.employees.filter((item) => item.active),
      departments: state.departments
    };
  }

  listRows(): FormTableRow[] {
    const state = this.repository.snapshot();
    return state.forms.map((form) => ({
      id: form.id,
      kind: form.kind,
      status: form.status,
      applicant: state.employees.find((item) => item.id === form.applicantId)?.name ?? '未知员工',
      department: state.departments.find((item) => item.id === form.departmentId)?.name ?? '未知部门',
      amountCents: form.amountCents,
      businessVersion: form.businessVersion
    }));
  }

  organizationTree(): OrganizationNode[] {
    const state = this.repository.snapshot();
    const nodes = new Map<string, OrganizationNode>();
    for (const department of state.departments) {
      nodes.set(department.id, {
        id: department.id,
        label: department.name,
        children: state.employees
          .filter((employee) => employee.active && employee.departmentId === department.id)
          .map((employee) => ({ id: employee.id, label: employee.name }))
      });
    }
    for (const department of state.departments) {
      if (!department.parentId) continue;
      const parent = nodes.get(department.parentId);
      const node = nodes.get(department.id);
      if (parent && node) parent.children?.push(node);
    }
    return state.departments
      .filter((item) => !item.parentId || !nodes.has(item.parentId))
      .flatMap((item) => {
        const node = nodes.get(item.id);
        return node ? [node] : [];
      });
  }

  validate(input: DraftFormInput): AwcpFieldError[] {
    return validateDraft(this.repository.snapshot(), input);
  }

  save(input: DraftFormInput): { formId: string; businessVersion: number; assetIds: string[] } {
    return this.repository.transact((draft) => {
      const errors = validateDraft(draft, input);
      if (errors.length > 0) {
        throw businessError('action.invalid-draft', errors.flatMap((item) => item.messages).join('；'));
      }
      const form = draft.forms.find((item) => item.id === input.formId);
      if (!form) throw businessError('action.form-not-found', '申请单不存在。');
      if (form.businessVersion !== input.expectedVersion) {
        throw businessError('action.version-conflict', '申请单版本已变化，请刷新后重试。', {
          actualVersion: form.businessVersion
        });
      }
      form.applicantId = input.applicantId;
      form.departmentId = input.departmentId;
      form.amountCents = input.amountCents;
      form.businessVersion += 1;
      const selected = new Set(input.assetIds);
      for (const attachment of draft.attachments) {
        if (attachment.ownerId === form.id && !selected.has(attachment.assetId)) attachment.ownerId = '';
        if (selected.has(attachment.assetId)) attachment.ownerId = form.id;
      }
      draft.auditEntries.push({
        id: `AUD-${String(draft.auditEntries.length + 1).padStart(3, '0')}`,
        entityType: 'form',
        entityId: form.id,
        action: 'save-draft',
        actorId: input.actorId,
        at: this.repository.clock.now(),
        fromStatus: 'draft',
        toStatus: 'draft',
        businessVersion: form.businessVersion
      });
      return { formId: form.id, businessVersion: form.businessVersion, assetIds: [...input.assetIds] };
    });
  }
}

function validateDraft(state: DemoState, input: DraftFormInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors: AwcpFieldError[] = [];
  const form = state.forms.find((item) => item.id === input.formId);
  if (!form) errors.push(fieldError(['formId'], '申请单不存在。'));
  else if (form.status !== 'draft') errors.push(fieldError(['formId'], '只有草稿可以编辑。'));

  const actor = state.employees.find((item) => item.id === input.actorId && item.active);
  if (!actor || actor.id !== form?.applicantId) errors.push(fieldError(['actorId'], '只有当前申请人可以编辑草稿。'));

  const applicant = state.employees.find((item) => item.id === input.applicantId && item.active);
  if (!applicant) errors.push(fieldError(['applicantId'], '申请人必须是有效员工。'));
  if (!state.departments.some((item) => item.id === input.departmentId)) {
    errors.push(fieldError(['departmentId'], '部门不存在。'));
  } else if (applicant && applicant.departmentId !== input.departmentId) {
    errors.push(fieldError(['departmentId'], '申请人与部门不匹配。'));
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
    errors.push(fieldError(['amountCents'], '金额必须是非负整数分。'));
  }
  if (!Array.isArray(input.assetIds)) {
    errors.push(fieldError(['assetIds'], '附件 ID 必须是数组。'));
    return errors;
  }
  if (new Set(input.assetIds).size !== input.assetIds.length) {
    errors.push(fieldError(['assetIds'], '附件 ID 不得重复。'));
  }
  input.assetIds.forEach((assetId, index) => {
    const attachment = state.attachments.find((item) => item.assetId === assetId);
    if (!attachment || (attachment.ownerId !== '' && attachment.ownerId !== input.formId)) {
      errors.push(fieldError(['assetIds', index], '附件不存在或已属于其他单据。'));
    }
  });
  return errors;
}
