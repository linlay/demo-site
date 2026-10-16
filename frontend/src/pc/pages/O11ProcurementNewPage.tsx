import { useCurrentActor } from '../../app/currentUserContext';
import { useAwcpAction, type AwcpActionRegistration } from '@app/awcp';
import { useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import { PURCHASE_CREATE_SCHEMA } from '../../common/awcp/procurementSchemas';
import type { DemoRepository } from '../../common/store/repository';
import { ProcurementService, type PurchaseCreateInput } from '../service/procurementService';
import styles from './BusinessScenePage.module.css';

const EXAMPLE: PurchaseCreateInput = { actorId: 'EMP-001', itemName: '办公显示器', quantity: 2, idempotencyKey: 'o11-create-example' };

export default function O11ProcurementNewPage({ repository }: { repository: DemoRepository }): ReactElement {
  const [service] = useState(() => new ProcurementService(repository));
  const actorId = useCurrentActor('EMP-001');
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [message, setMessage] = useState('');
  const action: AwcpActionRegistration<PurchaseCreateInput> = {
    action: 'office.procurement.create', title: '创建请购单',
    description: describeAction({ purpose: '创建虚构请购单。', prerequisites: '在职员工填写物品和数量。', parameters: 'actorId、itemName、quantity 和幂等键。', effects: '写入请购草稿。', result: '返回单据 ID 与版本。', failures: '字段或人员无效时不写入。' }),
    inputSchema: PURCHASE_CREATE_SCHEMA, examples: [EXAMPLE], validate: (args) => service.validateCreate(args), invoke: (args) => completed(service.create(args))
  };
  useAwcpAction(action);
  function submit(): void {
    if (!actorId || !itemName.trim() || !quantity) return;
    try { service.create({ actorId, itemName, quantity: Number(quantity), idempotencyKey: `o11-ui-${Date.now()}-${Math.random().toString(36).slice(2)}` }); }
    catch (error) { setMessage(error instanceof Error ? error.message : '创建请购单失败。'); }
  }
  return <section className={styles.page} aria-label="创建请购单表单">

    <label>采购物品 <input value={itemName} onChange={(event) => setItemName(event.target.value)} required /></label>
    <label>数量 <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value ? Number(event.target.value) : '')} required /></label>
    <button type="button" disabled={!actorId || !itemName.trim() || !quantity} onClick={submit}>创建请购单并查看详情</button>
    {message && <p role="alert">{message}</p>}
  </section>;
}
