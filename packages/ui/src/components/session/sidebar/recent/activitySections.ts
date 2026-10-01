import type { Session } from '@/lib/opencode/model';
import type { PendingBlockingRequests } from '@/sync/global-blocking-requests';
import type { SessionNode } from '../types';
import type { SidebarSessionLocation } from './sessionLocation';

type RecentSessionLocation = SidebarSessionLocation;

type SidebarActivityItem = {
  node: SessionNode;
  projectId: string | null;
  groupDirectory: string | null;
  secondaryMeta: { projectLabel?: string | null; branchLabel?: string | null } | null;
  getSecondaryMeta?: (sessionId: string) => SidebarActivityItem['secondaryMeta'];
  /**
   * A waiting row: the session holds an unanswered question or permission.
   * Pinned rows survive the section's reveal limit, so a pending request is
   * never cut off by "Show more" pagination.
   */
  pinned?: boolean;
};

type RecentActivitySection = {
  key: 'active-now';
  items: SidebarActivityItem[];
};

// Recent and Timeline filter their own lists with the sidebar's rule: an
// exact `ses_` id, otherwise a case-insensitive title match.
const matchesSidebarSessionQuery = (session: Session, query: string): boolean => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  if (normalizedQuery.startsWith('ses_')) return session.id.toLowerCase() === normalizedQuery;
  const title = typeof session.title === 'string' ? session.title.toLowerCase() : '';
  return title.includes(query);
};

/**
 * Whether a session tree answers a sidebar query: its root or any session
 * below it. A zone that lists whole trees and takes them out of every other
 * projection (In work) must keep a root whose subsession is the match, or the
 * match disappears from the sidebar entirely.
 */
export const sessionTreeMatchesSidebarQuery = (node: SessionNode, query: string): boolean => (
  matchesSidebarSessionQuery(node.session, query)
  || node.children.some((child) => sessionTreeMatchesSidebarQuery(child, query))
);

/** Sessions in a tree that answer the query themselves, ancestors kept only as context excluded. */
export const countSessionTreeQueryMatches = (node: SessionNode, query: string): number => (
  (matchesSidebarSessionQuery(node.session, query) ? 1 : 0)
  + node.children.reduce((total, child) => total + countSessionTreeQueryMatches(child, query), 0)
);

const RECENT_SESSION_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const isSubtaskSession = (session: Session): boolean => {
  return Boolean((session as Session & { parentID?: string | null }).parentID);
};

const isArchivedSession = (session: Session): boolean => {
  return Boolean(session.time?.archived);
};

const getSessionUpdatedAt = (session: Session): number => {
  const updated = session.time?.updated;
  const created = session.time?.created;
  if (typeof updated === 'number' && Number.isFinite(updated)) {
    return updated;
  }
  if (typeof created === 'number' && Number.isFinite(created)) {
    return created;
  }
  return 0;
};

// Recent contains non-archived root sessions that are active now or were
// updated within the retention window. The caller applies shared lifecycle
// ordering after this membership filter; batching ("Show more") handles long
// windows in the UI.
export const deriveRecentSessions = (
  sessions: Session[],
  activeSessionIds: ReadonlySet<string>,
  now = Date.now(),
): Session[] => {
  const minUpdatedAt = now - RECENT_SESSION_MAX_AGE_MS;
  return sessions.filter((session) => {
    if (isArchivedSession(session) || isSubtaskSession(session)) {
      return false;
    }
    return activeSessionIds.has(session.id) || getSessionUpdatedAt(session) >= minUpdatedAt;
  });
};

const attachRecentWorktrees = (
  node: SessionNode,
  getSessionLocation: (sessionId: string) => RecentSessionLocation | null,
): SessionNode => {
  const worktree = getSessionLocation(node.session.id)?.worktree ?? null;
  const children = node.children.map((child) => attachRecentWorktrees(child, getSessionLocation));
  if (worktree === node.worktree && children.every((child, index) => child === node.children[index])) {
    return node;
  }
  return { ...node, worktree, children };
};

// One projection for every row of the top zone, so Recent rows and waiting rows
// can never disagree on metadata, worktree attachment, or search matching.
const toActivityItem = (
  session: Session,
  getSessionLocation: (sessionId: string) => RecentSessionLocation | null,
  getSessionNode: ((session: Session) => SessionNode) | undefined,
  pinned?: boolean,
): SidebarActivityItem => {
  const location = getSessionLocation(session.id);
  const node = getSessionNode?.(session) ?? { session, children: [], worktree: null };
  return {
    node: attachRecentWorktrees(node, getSessionLocation),
    projectId: location?.projectId ?? null,
    groupDirectory: location?.groupDirectory ?? session.directory ?? null,
    secondaryMeta: location ? {
      projectLabel: location.projectLabel,
      branchLabel: location.branchLabel,
    } : null,
    getSecondaryMeta: (sessionId: string) => {
      const childLocation = getSessionLocation(sessionId);
      return childLocation ? {
        projectLabel: childLocation.projectLabel,
        branchLabel: childLocation.branchLabel,
      } : null;
    },
    pinned,
  };
};

/**
 * Session ids with an unanswered question or permission. The cross-directory
 * blocking index is the only source that also covers directories this client
 * never bootstrapped, which is exactly where a request would otherwise hide.
 */
export const selectPendingSessionIds = (
  bySession: ReadonlyMap<string, PendingBlockingRequests>,
): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const [sessionId, pending] of bySession) {
    if (pending.permissions.length > 0 || pending.forms.length > 0) ids.add(sessionId);
  }
  return ids;
};

/**
 * The waiting sessions themselves, in their incoming (lifecycle) order.
 * Subtasks count: a request asked by a subagent blocks that family, and the
 * row carrying the badge has to be the row the question is answered from.
 */
export const selectPendingSessions = (
  sessions: readonly Session[],
  pendingSessionIds: ReadonlySet<string>,
): Session[] => sessions.filter((session) => pendingSessionIds.has(session.id));

/**
 * Waiting sessions as top-zone rows, marked `pinned` so the row model keeps
 * them ahead of the Recent rows and outside the section's reveal limit.
 */
export const derivePendingActivityItems = ({
  sessions,
  pendingSessionIds,
  getSessionLocation,
  getSessionNode,
  query,
}: {
  sessions: readonly Session[];
  pendingSessionIds: ReadonlySet<string>;
  getSessionLocation: (sessionId: string) => RecentSessionLocation | null;
  getSessionNode?: (session: Session) => SessionNode;
  query: string;
}): SidebarActivityItem[] => selectPendingSessions(sessions, pendingSessionIds).flatMap((session) => (
  matchesSidebarSessionQuery(session, query)
    ? [toActivityItem(session, getSessionLocation, getSessionNode, true)]
    : []
));

/**
 * Waiting rows first, never twice: a session already lifted by a pending
 * request keeps its pinned row, and the Recent projection only contributes the
 * sessions that are not waiting.
 */
export const mergeActivityItems = (
  waiting: readonly SidebarActivityItem[],
  recent: readonly SidebarActivityItem[],
): SidebarActivityItem[] => {
  if (waiting.length === 0) return [...recent];
  const waitingIds = new Set(waiting.map((item) => item.node.session.id));
  return [...waiting, ...recent.filter((item) => !waitingIds.has(item.node.session.id))];
};

export const deriveRecentActivitySections = ({
  sessions,
  getSessionLocation,
  getSessionNode,
  query,
}: {
  sessions: Session[];
  getSessionLocation: (sessionId: string) => RecentSessionLocation | null;
  getSessionNode?: (session: Session) => SessionNode;
  query: string;
}): RecentActivitySection[] => [{
  key: 'active-now',
  items: sessions.flatMap((session) => (
    matchesSidebarSessionQuery(session, query)
      ? [toActivityItem(session, getSessionLocation, getSessionNode)]
      : []
  )),
}];

// Timeline lists every non-archived root project session as one flat zone.
// Ordering, membership, and branch/project metadata are resolved by the
// caller; this projection only applies the search filter and shapes rows.
export const deriveTimelineActivityItems = ({
  sessions,
  getSessionLocation,
  getSessionNode,
  query,
}: {
  sessions: readonly Session[];
  getSessionLocation: (sessionId: string) => SidebarSessionLocation | null;
  getSessionNode: (session: Session) => SessionNode;
  query: string;
}): SidebarActivityItem[] => sessions.flatMap((session) => {
  if (!matchesSidebarSessionQuery(session, query)) return [];
  const location = getSessionLocation(session.id);
  return [{
    node: getSessionNode(session),
    projectId: location?.projectId ?? null,
    groupDirectory: location?.groupDirectory ?? session.directory ?? null,
    secondaryMeta: {
      projectLabel: location?.projectLabel ?? null,
      branchLabel: location?.branchLabel ?? null,
    },
  }];
});
