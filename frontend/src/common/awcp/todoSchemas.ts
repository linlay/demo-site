const ACTOR = { type: 'string', pattern: '^EMP-[0-9]{3,}$' };
const KEY = { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' };

export const TODO_QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actorId'],
  properties: { actorId: ACTOR }
};

export const TODO_COMPLETE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actorId', 'todoId', 'expectedVersion', 'idempotencyKey'],
  properties: {
    actorId: ACTOR,
    todoId: { type: 'string', pattern: '^(?:TODO|OTODO)-[0-9]{3,}$' },
    expectedVersion: { type: 'integer', minimum: 1 },
    idempotencyKey: KEY
  }
};

export const TODO_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actorId', 'date'],
  properties: { actorId: ACTOR, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }
};
