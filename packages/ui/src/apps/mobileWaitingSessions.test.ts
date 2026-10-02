import { describe, expect, test } from 'bun:test';

import type { Session } from '@/lib/opencode/model';
import { orderSessionsByLifecycleScopes } from '@/sync/session-ordering';

import { collectPendingSessionIds, selectWaitingSessions } from './mobileWaitingSessions';

// SAFETY: the fixtures cover every field the ordering and the selection read.
const session = (id: string, idle: number, parentID?: string): Session => ({
  id,
  projectID: 'project',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  title: id,
  directory: '/workspace',
  parentID,
  time: { created: idle, idle, updated: idle },
}) as Session;

const noDescendants = (): string[] => [];

describe('mobile waiting sessions', () => {
  test('a waiting session leads the block although a newer quiet session sorts first in the list', () => {
    const quiet = session('ses_quiet-newer', 1_000);
    const waiting = session('ses_waiting-older', 100);

    // Without the block the plain list leads with the most recently touched
    // session — the quiet one.
    const list = orderSessionsByLifecycleScopes([quiet, waiting], new Set(), new Map());
    expect(list.map((entry) => entry.id)).toEqual(['ses_quiet-newer', 'ses_waiting-older']);

    // The block that leads the whole surface lifts the waiting session and
    // leaves the quiet one to the list below.
    const block = selectWaitingSessions({
      sessions: [quiet, waiting],
      pendingSessionIds: new Set(['ses_waiting-older']),
      descendantIdsOf: noDescendants,
      pinnedSessionIds: new Set<string>(),
      sessionOrderRanks: new Map<string, number>(),
    });
    expect(block.map((entry) => entry.id)).toEqual(['ses_waiting-older']);
  });

  test('a root stands for a hidden waiting subsession and no subagent gets a second row', () => {
    const root = session('ses_root', 100);
    const child = session('ses_child', 200, 'ses_root');
    const quietRoot = session('ses_quiet-root', 300);

    const block = selectWaitingSessions({
      sessions: [quietRoot, root, child],
      pendingSessionIds: new Set(['ses_child']),
      descendantIdsOf: (sessionId) => (sessionId === 'ses_root' ? ['ses_child'] : []),
      pinnedSessionIds: new Set<string>(),
      sessionOrderRanks: new Map<string, number>(),
    });

    // The child's request surfaces as the row it is answered from, and the
    // root is not listed twice.
    expect(block.map((entry) => entry.id)).toEqual(['ses_root']);
  });

  test('an empty queue shows no block at all', () => {
    expect(selectWaitingSessions({
      sessions: [session('ses_a', 100), session('ses_b', 200)],
      pendingSessionIds: new Set(),
      descendantIdsOf: noDescendants,
      pinnedSessionIds: new Set<string>(),
      sessionOrderRanks: new Map<string, number>(),
    })).toEqual([]);

    // A request for a session the list does not hold is nobody's row either.
    expect(selectWaitingSessions({
      sessions: [session('ses_a', 100)],
      pendingSessionIds: new Set(['ses_elsewhere']),
      descendantIdsOf: noDescendants,
      pinnedSessionIds: new Set<string>(),
      sessionOrderRanks: new Map<string, number>(),
    })).toEqual([]);
  });

  test('an active search filters the block instead of leaving stale rows', () => {
    const first = session('ses_first', 200);
    const second = session('ses_second', 100);
    const input = {
      sessions: [first, second],
      pendingSessionIds: new Set(['ses_first', 'ses_second']),
      descendantIdsOf: noDescendants,
      pinnedSessionIds: new Set<string>(),
      sessionOrderRanks: new Map<string, number>(),
    };

    // Newest first: the block keeps the list's own lifecycle order.
    expect(selectWaitingSessions(input).map((entry) => entry.id)).toEqual(['ses_first', 'ses_second']);
    // The query narrows it to the matching row.
    expect(selectWaitingSessions({ ...input, matchesQuery: (entry) => entry.id === 'ses_second' }).map((row) => row.id))
      .toEqual(['ses_second']);
    // Nothing matching leaves no block.
    expect(selectWaitingSessions({ ...input, matchesQuery: () => false })).toEqual([]);
  });

  test('collects the ids the blocking index still waits on, questions and permissions alike', () => {
    expect([...collectPendingSessionIds(new Map([
      ['ses_form', { directory: '/workspace', permissions: [], forms: [{ id: 'form-1', sessionID: 'ses_form', title: 'Pick' }] }],
      ['ses_permission', { directory: '/workspace', permissions: [{ id: 'perm-1', sessionID: 'ses_permission', action: 'bash', resources: [] }], forms: [] }],
      ['ses_settled', { directory: '/workspace', permissions: [], forms: [] }],
    ]))].sort()).toEqual(['ses_form', 'ses_permission']);
  });
});
