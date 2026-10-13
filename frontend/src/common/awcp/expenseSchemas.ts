export const EXPENSE_CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actorId', 'travelFormId', 'receipts', 'lineItems', 'declaredTotalCents', 'idempotencyKey'],
  properties: {
    actorId: { type: 'string', pattern: '^EMP-[0-9]{3,}$' },
    travelFormId: { type: 'string', pattern: '^FORM-[0-9]{3,}$' },
    receipts: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['invoiceNo', 'assetId', 'amountCents'],
        properties: {
          invoiceNo: { type: 'string', minLength: 1, maxLength: 64 },
          assetId: { type: 'string', pattern: '^AST-[0-9]{3,}$' },
          amountCents: { type: 'integer', minimum: 1 }
        }
      }
    },
    lineItems: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'invoiceNo', 'amountCents'],
        properties: {
          category: { type: 'string', enum: ['transport', 'hotel', 'meal', 'other'] },
          invoiceNo: { type: 'string', minLength: 1, maxLength: 64 },
          amountCents: { type: 'integer', minimum: 1 }
        }
      }
    },
    declaredTotalCents: { type: 'integer', minimum: 1 },
    idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' }
  }
};

const MUTATION_PROPERTIES = {
  expenseFormId: { type: 'string', pattern: '^FORM-[0-9]{3,}$' },
  actorId: { type: 'string', pattern: '^EMP-[0-9]{3,}$' },
  expectedVersion: { type: 'integer', minimum: 1 },
  idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' }
};

export const EXPENSE_SUBMIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['expenseFormId', 'actorId', 'expectedVersion', 'idempotencyKey'],
  properties: MUTATION_PROPERTIES
};

export const EXPENSE_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['expenseFormId', 'actorId', 'expectedVersion', 'idempotencyKey', 'decision', 'reason'],
  properties: {
    ...MUTATION_PROPERTIES,
    decision: { type: 'string', enum: ['approve', 'return'] },
    reason: { type: 'string', maxLength: 200 }
  }
};

export const EXPENSE_CORRECT_SCHEMA = {
  ...EXPENSE_CHECK_SCHEMA,
  required: [...EXPENSE_CHECK_SCHEMA.required, 'expenseFormId', 'expectedVersion'],
  properties: {
    ...EXPENSE_CHECK_SCHEMA.properties,
    expenseFormId: MUTATION_PROPERTIES.expenseFormId,
    expectedVersion: MUTATION_PROPERTIES.expectedVersion
  }
};

export const EXPENSE_READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['expenseFormId', 'actorId'],
  properties: {
    expenseFormId: MUTATION_PROPERTIES.expenseFormId,
    actorId: MUTATION_PROPERTIES.actorId
  }
};
