import type { Session } from '@/lib/opencode/model';
import type { PendingBlockingRequests } from '@/sync/global-blocking-requests';
import { orderSessionsByLifecycleScopes } from '@/sync/session-ordering';

import { getParentId } from './mobileSessionFields';

/**
 * Session ids the cross-directory request index still holds an answer for. It
 * is the same index the row badges read, so the leading block and the rows can
 * never disagree about what is waiting — and a project this phone never opened
 * is covered too.
 */
export const collectPendingSessionIds = (
  bySession: ReadonlyMap<string, PendingBlockingRequests>,
): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const [sessionId, pending] of bySession) {
    if (pending.permissions.length > 0 || pending.forms.length > 0) ids.add(sessionId);
  }
  return ids;
};

export type WaitingSessionSelection = {
  /** Every non-archived session the list knows, in store order. */
  sessions: readonly Session[];
  /** Ids with an unanswered question or permission (see collectPendingSessionIds). */
  pendingSessionIds: ReadonlySet<string>;
  /** The list's own descendants helper: a hidden subagent's request blocks its family. */
  descendantIdsOf: (sessionId: string) => readonly string[];
  pinnedSessionIds: Set<string>;
  sessionOrderRanks: ReadonlyMap<string, number>;
  /** The active search filter, applied to the block like to every other row. */
  matchesQuery?: (session: Session) => boolean;
};

/**
 * The sessions the leading "Waiting for you" block shows: one row per session
 * tree that holds an unanswered request.
 *
 * A root stands for its hidden subsessions — the same rule the collapsed row's
 * badge uses — so a question a subagent asked still surfaces as the row it is
 * answered from. Only top-level rows lead; a subagent never gets a second row
 * next to its root. Ordering is the list's own lifecycle order, and an active
 * search narrows the block instead of contradicting it, so the block keeps
 * leading whatever the list below is filtered to.
 */
export const selectWaitingSessions = ({
  sessions,
  pendingSessionIds,
  descendantIdsOf,
  pinnedSessionIds,
  sessionOrderRanks,
  matchesQuery,
}: WaitingSessionSelection): Session[] => {
  if (pendingSessionIds.size === 0) return [];
  const idsInList = new Set(sessions.map((session) => session.id));
  const waiting = sessions.filter((session) => {
    const parentId = getParentId(session);
    if (parentId && idsInList.has(parentId)) return false;
    if (pendingSessionIds.has(session.id)) return true;
    return descendantIdsOf(session.id).some((id) => pendingSessionIds.has(id));
  });
  const ordered = orderSessionsByLifecycleScopes(waiting, pinnedSessionIds, sessionOrderRanks);
  return matchesQuery ? ordered.filter(matchesQuery) : ordered;
};
