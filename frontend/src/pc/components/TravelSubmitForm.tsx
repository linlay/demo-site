import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useState, type FormEvent, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import type { TravelSubmitInput, TravelService } from '../service/travelService';
import styles from './TravelSubmitForm.module.css';

const TRAVEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'actorId',
    'departmentId',
    'travelerIds',
    'origin',
    'destination',
    'startAt',
    'endAt',
    'estimatedAmountCents',
    'idempotencyKey'
  ],
  properties: {
    actorId: { type: 'string', pattern: '^EMP-[0-9]{3}$' },
    departmentId: { type: 'string', pattern: '^DEP-[0-9]{3}$' },
    travelerIds: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
      items: { type: 'string', pattern: '^EMP-[0-9]{3}$' }
    },
    origin: { type: 'string', minLength: 1, maxLength: 80 },
    destination: { type: 'string', minLength: 1, maxLength: 80 },
    startAt: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$'
    },
    endAt: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$'
    },
    estimatedAmountCents: { type: 'integer', minimum: 1 },
    idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' }
  }
};

const TRAVEL_EXAMPLE: TravelSubmitInput = {
  actorId: 'EMP-001',
  departmentId: 'DEP-001',
  travelerIds: ['EMP-001'],
  origin: '上海',
  destination: '北京',
  startAt: '2026-09-24T09:00:00+08:00',
  endAt: '2026-09-25T18:00:00+08:00',
  estimatedAmountCents: 180000,
  idempotencyKey: 'o09-travel-example-001'
};

function newIntentKey(): string {
  return `travel-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface TravelSubmitFormProps {
  service: TravelService;
}

export function TravelSubmitForm({ service }: TravelSubmitFormProps): ReactElement {
  const actorId = useCurrentActor('EMP-001');
  const [travelerIds, setTravelerIds] = useState<string[]>([actorId]);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [amountCents, setAmountCents] = useState<number | ''>('');
  const [intentKey, setIntentKey] = useState(newIntentKey);
  const [message, setMessage] = useState('');
  const employees = service.employees();
  const actor = employees.find((employee) => employee.id === actorId);


  const registration: AwcpActionRegistration<TravelSubmitInput> = {
    action: 'office.travel.submit',
    title: '提交出差申请',
    description: describeAction({
      purpose: '按行程、时间与同行人员提交虚构出差申请。',
      prerequisites: '使用页面公布的有效员工与部门；行程在模拟时钟之后，部门有主管。',
      parameters: '金额单位为整数分；时间需包含时区；idempotencyKey 是同一业务意图的稳定键，与 requestId 独立。',
      effects: '原子创建已提交单据、行程、主管待办、审计及业务幂等记录。',
      result: '返回 completed、单据 ID、submitted 状态和业务版本。',
      failures: '结束早于开始、人员越权或业务键冲突均不写入；先修正参数或查询已有结果。'
    }),
    inputSchema: TRAVEL_SCHEMA,
    examples: [TRAVEL_EXAMPLE],
    validate: (args) => service.validate(args),
    invoke: (args) => completed(service.submit(args))
  };
  useAwcpAction(registration);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const input: TravelSubmitInput = {
      actorId,
      departmentId: actor?.departmentId ?? '',
      travelerIds,
      origin,
      destination,
      startAt: `${startLocal}:00+08:00`,
      endAt: `${endLocal}:00+08:00`,
      estimatedAmountCents: Number(amountCents),
      idempotencyKey: intentKey
    };
    try {
      const result = service.submit(input);
      setMessage(`已提交 ${result.formId}，业务版本 ${result.businessVersion}。`);
      setIntentKey(newIntentKey());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败。');
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="travel-title">
      <h2 id="travel-title">O09-01 填写出差申请</h2>
      <p>全部数据均为虚构演示；时间按北京时间填写，金额单位为分。</p>
      <form className={styles.form} aria-label="提交出差申请" onSubmit={submit}>


        <p>所属部门：{actor?.departmentId ?? '未选择'}</p>
        <fieldset>
          <legend>同行人员（包含申请人）</legend>
          {employees
            .filter((employee) => employee.departmentId === actor?.departmentId)
            .map((employee) => (
              <label key={employee.id} className={styles.traveler}>
                <input
                  type="checkbox"
                  checked={travelerIds.includes(employee.id)}
                  disabled={employee.id === actorId}
                  onChange={(event) =>
                    setTravelerIds((current) =>
                      event.target.checked ? [...current, employee.id] : current.filter((id) => id !== employee.id)
                    )
                  }
                />
                {employee.name}（{employee.id}）
              </label>
            ))}
        </fieldset>
        <label htmlFor="travel-origin">出发地</label>
        <input
          id="travel-origin"
          value={origin}
          maxLength={80}
          onChange={(event) => setOrigin(event.target.value)}
          required
        />
        <label htmlFor="travel-destination">目的地</label>
        <input
          id="travel-destination"
          value={destination}
          maxLength={80}
          onChange={(event) => setDestination(event.target.value)}
          required
        />
        <label htmlFor="travel-start">开始时间（北京时间）</label>
        <input
          id="travel-start"
          type="datetime-local"
          value={startLocal}
          onChange={(event) => setStartLocal(event.target.value)}
          required
        />
        <label htmlFor="travel-end">结束时间（北京时间）</label>
        <input
          id="travel-end"
          type="datetime-local"
          value={endLocal}
          onChange={(event) => setEndLocal(event.target.value)}
          required
        />
        <label htmlFor="travel-amount">预计金额（分）</label>
        <input
          id="travel-amount"
          type="number"
          min="1"
          step="1"
          value={amountCents}
          onChange={(event) => setAmountCents(event.target.value ? Number(event.target.value) : '')}
          required
        />
        <button type="submit" disabled={!actorId || !origin.trim() || !destination.trim() || !startLocal || !endLocal || !amountCents}>提交申请</button>
        <p role="status">{message}</p>
      </form>
    </section>
  );
}
