const ACTOR = { type: 'string', pattern: '^EMP-[0-9]{3,}$' };
const REQUEST = { type: 'string', pattern: '^APPR-[0-9]{3,}$' };
const KEY = { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' };
const VERSION = { type: 'integer', minimum: 1 };
const REQUEST_FIELDS = { requestId: REQUEST, actorId: ACTOR };

export const APPROVAL_SUBMIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'actorId', 'expectedVersion', 'title', 'description', 'materialIds', 'idempotencyKey'],
  properties: {
    requestId: { anyOf: [REQUEST, { type: 'null' }] },
    actorId: ACTOR,
    expectedVersion: { anyOf: [VERSION, { type: 'null' }] },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', minLength: 1, maxLength: 2000 },
    materialIds: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
      items: { type: 'string', pattern: '^APMAT-[0-9]{3,}$' }
    },
    idempotencyKey: KEY
  }
};
export const APPROVAL_READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'actorId'],
  properties: REQUEST_FIELDS
};
export const APPROVAL_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'actorId', 'expectedVersion', 'opinion', 'idempotencyKey'],
  properties: {
    ...REQUEST_FIELDS,
    expectedVersion: VERSION,
    opinion: { type: 'string', minLength: 1, maxLength: 200 },
    idempotencyKey: KEY
  }
};
export const APPROVAL_WITHDRAW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'actorId', 'expectedVersion', 'reason', 'idempotencyKey'],
  properties: {
    ...REQUEST_FIELDS,
    expectedVersion: VERSION,
    reason: { type: 'string', minLength: 1, maxLength: 200 },
    idempotencyKey: KEY
  }
};
