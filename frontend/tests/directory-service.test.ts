import { expect, it } from 'vitest';

import { DemoRepository } from '../src/common/store/repository';
import { DirectoryService } from '../src/pc/service/directoryService';

it('queries active cross-department contacts and returns an empty result for unknown filters', () => {
  const service = new DirectoryService(new DemoRepository());
  const research = service.query({ actorId: 'EMP-008', departmentId: 'DEP-002', name: '' }).employees;
  expect(research.map((item) => item.id)).toEqual(['EMP-003', 'EMP-005', 'EMP-007']);
  expect(service.query({ actorId: 'EMP-008', departmentId: 'DEP-999', name: '' }).employees).toEqual([]);
  expect(service.query({ actorId: 'EMP-008', departmentId: '', name: '不存在的联系人' }).employees).toEqual([]);
  expect(
    service.query({ actorId: 'EMP-008', departmentId: '', name: '' }).employees.some((item) => item.id === 'EMP-012')
  ).toBe(false);
  expect(service.validateQuery({ actorId: 'EMP-012', departmentId: '', name: '' }).map((item) => item.path)).toEqual([
    ['actorId']
  ]);
});

it('replaces team members atomically with version, active-person and idempotency guards', () => {
  const repository = new DemoRepository();
  const service = new DirectoryService(repository);
  const input = {
    teamId: 'TEAM-001',
    actorId: 'EMP-008',
    expectedVersion: 1,
    memberIds: ['EMP-003', 'EMP-004'],
    idempotencyKey: 'o02-team-replace'
  };
  const initial = repository.snapshot();
  expect(service.validateReplaceTeam({ ...input, memberIds: ['EMP-012'] }).map((item) => item.path)).toContainEqual([
    'memberIds'
  ]);
  expect(
    service.validateReplaceTeam({ ...input, memberIds: ['EMP-003', 'EMP-003'] }).map((item) => item.path)
  ).toContainEqual(['memberIds']);
  expect(service.validateReplaceTeam({ ...input, actorId: 'EMP-003' }).map((item) => item.path)).toContainEqual([
    'actorId'
  ]);
  expect(service.validateReplaceTeam({ ...input, expectedVersion: 2 }).map((item) => item.path)).toContainEqual([
    'expectedVersion'
  ]);
  expect(repository.snapshot()).toEqual(initial);
  expect(service.replaceTeam(input)).toEqual({ id: 'TEAM-001', businessVersion: 2 });
  expect(service.replaceTeam(input)).toEqual({ id: 'TEAM-001', businessVersion: 2 });
  expect(service.readTeam({ teamId: 'TEAM-001', actorId: 'EMP-004' })).toMatchObject({
    projectId: 'IBP-001',
    memberIds: ['EMP-003', 'EMP-004'],
    businessVersion: 2
  });
  expect(service.validateReadTeam({ teamId: 'TEAM-001', actorId: 'EMP-009' }).map((item) => item.path)).toEqual([
    ['actorId']
  ]);
  expect(repository.snapshot().auditEntries.filter((item) => item.entityId === 'TEAM-001')).toHaveLength(1);
});

it('saves group additions and removals and reads back the current member set', () => {
  const repository = new DemoRepository();
  const service = new DirectoryService(repository);
  const input = {
    groupId: 'CGROUP-001',
    actorId: 'EMP-008',
    expectedVersion: 1,
    memberIds: ['EMP-009', 'EMP-004'],
    idempotencyKey: 'o02-group-save'
  };
  expect(service.saveGroup(input)).toEqual({ id: 'CGROUP-001', businessVersion: 2 });
  expect(service.readGroup({ groupId: 'CGROUP-001', actorId: 'EMP-004' })).toMatchObject({
    memberIds: ['EMP-009', 'EMP-004'],
    businessVersion: 2
  });
  expect(
    service
      .validateSaveGroup({ ...input, expectedVersion: 1, idempotencyKey: 'o02-group-stale' })
      .map((item) => item.path)
  ).toContainEqual(['expectedVersion']);
  expect(service.saveGroup({ ...input, expectedVersion: 2, memberIds: [], idempotencyKey: 'o02-group-clear' })).toEqual(
    { id: 'CGROUP-001', businessVersion: 3 }
  );
  expect(service.readGroup({ groupId: 'CGROUP-001', actorId: 'EMP-008' }).memberIds).toEqual([]);
});
