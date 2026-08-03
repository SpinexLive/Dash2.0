import test from 'node:test';
import assert from 'node:assert/strict';
import { findInactiveMemberUserIds, memberHasConfiguredRole } from './role-sync.job';

test('findInactiveMemberUserIds returns members that are not present in the current guild snapshot', () => {
  const existingMemberUserIds = [1n, 2n, 3n, 4n];
  const keepUserIds = [2n, 4n];

  assert.deepEqual(findInactiveMemberUserIds(existingMemberUserIds, keepUserIds), [1n, 3n]);
});

test('findInactiveMemberUserIds deactivates every existing member when no current guild members are kept', () => {
  const existingMemberUserIds = [1n, 2n, 3n];
  const keepUserIds: bigint[] = [];

  assert.deepEqual(findInactiveMemberUserIds(existingMemberUserIds, keepUserIds), [1n, 2n, 3n]);
});

test('memberHasConfiguredRole matches members that hold any configured member role', () => {
  assert.equal(memberHasConfiguredRole(['role-a', 'role-b'], ['role-c', 'role-a']), true);
  assert.equal(memberHasConfiguredRole(['role-a', 'role-b'], ['role-c']), false);
});
