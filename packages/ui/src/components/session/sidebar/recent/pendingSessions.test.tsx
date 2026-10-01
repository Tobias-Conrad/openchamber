import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { OpenCode } from '@opencode/client';
import type { Session } from '@/lib/opencode/model';
import {
  applyGlobalBlockingRequestEvents,
  resetGlobalBlockingRequests,
  seedGlobalBlockingRequests,
  useGlobalBlockingRequestsStore,
  type BlockingFormRequest,
  type BlockingPermissionRequest,
} from '@/sync/global-blocking-requests';
import {
  derivePendingActivityItems,
  deriveRecentActivitySections,
  mergeActivityItems,
  selectPendingSessionIds,
  selectPendingSessions,
} from './activitySections';
import {
  buildSessionSidebarRowModel,
  type SessionSidebarActivityItem,
  type SessionSidebarRow,
  type SessionSidebarRowModelArgs,
} from '../sessionSidebarRowModel';

// The sprite-injecting icon is a presentational leaf; the badge assertions care
// about which badge rendered, so it renders as a marker element here.
mock.module('@/components/icon/Icon', () => ({
  Icon: ({ name, className }: { name: string; className?: string }) => (
    <svg className={className} data-icon={name} aria-hidden="true" />
  ),
}));

// A real DOM: the waiting row is asserted through the markup the component
// actually produces, not through counters handed to a badge in the test.
const dom = new Window();
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  localStorage: dom.localStorage,
  HTMLElement: dom.HTMLElement,
  Element: dom.Element,
  Event: dom.Event,
  Node: dom.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import('react-dom/client');
const { I18nProvider } = await import('@/lib/i18n');
const { SyncProvider, useChildStoreManager } = await import('@/sync/sync-context');
const { SessionTreeItem } = await import('../sessions/SessionTreeItem');

const permission = (id: string, sessionID: string): BlockingPermissionRequest => ({
  id, sessionID, action: 'bash', resources: ['rm *'],
});
const form = (id: string, sessionID: string): BlockingFormRequest => ({ id, sessionID, title: 'Pick one' });

// SAFETY: the selectors only read the session identity used by the fixtures.
const session = (id: string, parentID?: string): Session => ({
  id, title: id, directory: '/repo', parentID, time: { created: 1, updated: 1 },
} as Session);

const rowArgs = (
  recentSections: readonly { key: 'active-now'; items: readonly SessionSidebarActivityItem[] }[],
  showRecentSection: boolean,
): SessionSidebarRowModelArgs => ({
  mode: 'normal',
  sections: [],
  authoritativeSections: [],
  chatGroup: null,
  recentSections,
  showRecentSection,
  foldersMap: {},
  groupSearchDataByGroup: new WeakMap(),
  normalizedQuery: '',
  collapsedProjects: new Set(),
  collapsedGroups: new Set(),
  collapsedFolders: new Set(),
  collapsedActivities: new Set(),
  expandedParents: new Set(),
  visibleCountByContainer: new Map(),
  pinnedSessionIds: new Set(),
  sessionOrderIndex: new Map(),
  groupStatusByKey: new Map(),
  folderAuthorityByOwner: new Map(),
  activeProjectId: null,
  singleProjectMode: false,
  singleProjectId: null,
  showOnlyMainWorkspace: false,
  hideDirectoryControls: false,
});

const sessionRowIds = (args: SessionSidebarRowModelArgs): string[] => buildSessionSidebarRowModel(args).rows
  .flatMap((row) => (row.kind === 'session' ? [row.node.session.id] : []));

const sectionsOf = (items: ReturnType<typeof mergeActivityItems>) => (
  items.length === 0 ? [] : [{ key: 'active-now' as const, items }]
);

beforeEach(() => resetGlobalBlockingRequests());

describe('pending sessions in the top zone', () => {
  test('selects the sessions holding an unanswered question or permission, subtasks included', () => {
    applyGlobalBlockingRequestEvents('/repo', [
      { type: 'permission.asked', properties: permission('p1', 'needs-permission') },
      { type: 'form.created', properties: { form: { ...form('q1', 'needs-question'), fields: [{ key: 'answer', type: 'boolean' }] } } },
      { type: 'permission.asked', properties: permission('p2', 'subtask') },
      { type: 'form.created', properties: { form: { ...form('q2', 'settled'), fields: [{ key: 'answer', type: 'boolean' }] } } },
    ]);
    applyGlobalBlockingRequestEvents('/repo', [{ type: 'form.settled', properties: { sessionID: 'settled', formID: 'q2' } }]);

    const bySession = useGlobalBlockingRequestsStore.getState().bySession;
    const pendingSessionIds = selectPendingSessionIds(bySession);
    expect([...pendingSessionIds].sort()).toEqual(['needs-permission', 'needs-question', 'subtask']);

    const sessions = [
      session('needs-permission'),
      session('needs-question'),
      session('quiet'),
      session('subtask', 'needs-question'),
      session('settled'),
    ];
    // (i) question, (ii) permission, (iv) subtask: all three are collected.
    // (iii) a session without either kind stays out, and a settled request is gone.
    expect(selectPendingSessions(sessions, pendingSessionIds).map((entry) => entry.id))
      .toEqual(['needs-permission', 'needs-question', 'subtask']);

    const items = derivePendingActivityItems({
      sessions,
      pendingSessionIds,
      getSessionLocation: () => null,
      query: '',
    });
    expect(items.map((item) => [item.node.session.id, item.pinned]))
      .toEqual([['needs-permission', true], ['needs-question', true], ['subtask', true]]);
  });

  test('merges waiting rows ahead of Recent rows without listing a session twice', () => {
    const waitingItem = (id: string): SessionSidebarActivityItem => ({
      node: { session: session(id), children: [], worktree: null },
      projectId: null, groupDirectory: '/repo', secondaryMeta: null, pinned: true,
    });
    const recentItem = (id: string): SessionSidebarActivityItem => ({
      node: { session: session(id), children: [], worktree: null },
      projectId: null, groupDirectory: '/repo', secondaryMeta: null,
    });

    const merged = mergeActivityItems(
      [waitingItem('waiting'), waitingItem('shared')],
      [recentItem('shared'), recentItem('other')],
    );

    expect(merged.map((item) => item.node.session.id)).toEqual(['waiting', 'shared', 'other']);
    expect(merged[0]?.pinned).toBe(true);
    expect(merged[2]?.pinned).toBeUndefined();
  });

  test('keeps every waiting row when the Recent rows are cut by the reveal limit', () => {
    const waiting = Array.from({ length: 12 }, (_, index) => ({
      node: { session: session(`waiting-${index}`), children: [], worktree: null },
      projectId: null, groupDirectory: '/repo', secondaryMeta: null, pinned: true,
    }));
    const recent = Array.from({ length: 20 }, (_, index) => ({
      node: { session: session(`recent-${index}`), children: [], worktree: null },
      projectId: null, groupDirectory: '/repo', secondaryMeta: null,
    }));

    const ids = sessionRowIds(rowArgs([{ key: 'active-now', items: [...waiting, ...recent] }], true));

    expect(ids.slice(0, 12)).toEqual(waiting.map((item) => item.node.session.id));
    expect(ids).toHaveLength(12 + 7);
    expect(ids).not.toContain('recent-7');
  });

  test('shows the waiting rows even with the Recent section switched off', () => {
    const waiting = [{ node: { session: session('waiting'), children: [], worktree: null }, projectId: null, groupDirectory: '/repo', secondaryMeta: null, pinned: true }];
    const recent = [{ node: { session: session('recent'), children: [], worktree: null }, projectId: null, groupDirectory: '/repo', secondaryMeta: null }];

    const switchedOff = buildSessionSidebarRowModel(rowArgs([{ key: 'active-now', items: [...waiting, ...recent] }], false));
    expect(switchedOff.rows[0]).toMatchObject({ kind: 'activity-header', activityKey: 'active-now' });
    expect(sessionRowIds(rowArgs([{ key: 'active-now', items: [...waiting, ...recent] }], false))).toEqual(['waiting']);

    // Without a waiting row the switch keeps the zone hidden entirely.
    expect(buildSessionSidebarRowModel(rowArgs([{ key: 'active-now', items: recent }], false)).rows).toEqual([
      { kind: 'empty', key: 'sidebar:empty', estimateSize: 72, emptyKind: 'sidebar' },
    ]);
  });

  test('renders the waiting row as the first zone row, with the switch off', () => {
    const recentItems = deriveRecentActivitySections({
      sessions: [session('quiet')], getSessionLocation: () => null, query: '',
    })[0]?.items ?? [];
    const waiting = (id: string): SessionSidebarActivityItem => ({
      node: { session: session(id), children: [], worktree: null },
      projectId: null, groupDirectory: '/repo', secondaryMeta: null, pinned: true,
    });
    const sections = sectionsOf(mergeActivityItems([waiting('asked'), waiting('waiting')], recentItems));
    const idsOf = (showRecentSection: boolean) => buildSessionSidebarRowModel(rowArgs(sections, showRecentSection)).rows
      .flatMap((row) => (row.kind === 'session' ? [row.node.session.id] : []));

    // The zone header is rendered although showRecentSection is false, the
    // waiting rows lead it, and the quiet Recent row only follows them once
    // the switch is on.
    expect(buildSessionSidebarRowModel(rowArgs(sections, false)).rows[0])
      .toMatchObject({ kind: 'activity-header', activityKey: 'active-now' });
    expect(idsOf(false)).toEqual(['asked', 'waiting']);
    expect(idsOf(true)).toEqual(['asked', 'waiting', 'quiet']);
  });

  // The waiting rows are drawn from the cross-directory request index, but the
  // row itself counted from its own directory store. A directory the client
  // never opened has no store entry, so the badge stayed invisible although
  // the row was lifted into the top zone. These tests render the real row and
  // read the badge out of the markup.
  const sdk = () => OpenCode.make({
    baseUrl: 'https://sync.test',
    fetch: async (request) => {
      const path = new URL(request instanceof Request ? request.url : request.toString()).pathname;
      if (path.endsWith('/event')) {
        return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
      }
      const body = path.endsWith('/location')
        ? { directory: '/workspace', project: { id: 'project', directory: '/workspace', canonical: '/workspace' } }
        : path.endsWith('/session/active') ? {} : { data: [] };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    },
  });
  const noop = () => undefined;
  const noopWorktreeLoad = () => ({ cachedTargets: [], refreshTargets: Promise.resolve([]) });
  const EMPTY_IDS: Set<string> = new Set();

  // Prop bag the sidebar scroller spreads onto every row, trimmed to what the
  // row reads here. `renderContext: 'recent'` is what the top zone uses.
  const RealRow = ({ row }: { row: Extract<SessionSidebarRow, { kind: 'session' }> }) => (
    <SessionTreeItem
      node={row.node}
      depth={row.depth}
      groupDirectory={row.groupDirectory}
      projectId={row.projectId}
      folderOwnerKey={row.ownerKey}
      selectionScopeKey={row.selectionScopeKey}
      archivedBucket={row.archived}
      renderContext={row.renderContext}
      rowKey={row.key}
      dragKey={row.key}
      secondaryMeta={row.secondaryMeta}
      renderChildren={false}
      pinnedSessionIds={EMPTY_IDS}
      expandedParents={EMPTY_IDS}
      hasSessionSearchQuery={false}
      normalizedSessionSearchQuery=""
      notifyOnSubtasks={false}
      editingId={null}
      editingRowKey={null}
      setEditingId={noop}
      setEditingRowKey={noop}
      editTitle=""
      setEditTitle={noop}
      toggleParent={noop}
      openSidebarMenuKey={null}
      setOpenSidebarMenuKey={noop}
      allowReselect={false}
      resetSessionSearch={noop}
      deleteSessionConfirm={null}
      setDeleteSessionConfirm={noop}
      startFolderRename={noop}
      startSessionWorktreeMenuLoad={noopWorktreeLoad}
      mobileVariant={false}
      alwaysShowActions={false}
    />
  );

  const RealRows = ({ rows, fill }: { rows: readonly SessionSidebarRow[]; fill?: React.ReactNode }) => (
    <SyncProvider sdk={sdk()} directory="/workspace">
      <I18nProvider>
        {fill}
        {rows.map((row) => (row.kind === 'session' ? <RealRow key={row.key} row={row} /> : null))}
      </I18nProvider>
    </SyncProvider>
  );

  const rowsFor = (sessions: Session[]): readonly SessionSidebarRow[] => {
    const pendingSessionIds = selectPendingSessionIds(useGlobalBlockingRequestsStore.getState().bySession);
    const items = mergeActivityItems(
      derivePendingActivityItems({ sessions, pendingSessionIds, getSessionLocation: () => null, query: '' }),
      deriveRecentActivitySections({ sessions, getSessionLocation: () => null, query: '' })[0]?.items ?? [],
    );
    return buildSessionSidebarRowModel(rowArgs(sectionsOf(items), true)).rows;
  };

  const rowIds = (container: Element): string[] => Array.from(container.querySelectorAll('[data-session-row]'))
    .map((element) => element.getAttribute('data-session-row') ?? '');
  /** Number the badge shows for one row, read from the badge element itself. */
  const badgeNumber = (container: Element, sessionId: string, icon: 'shield' | 'question'): string | null => {
    const row = container.querySelector(`[data-session-row="${sessionId}"]`);
    return row?.querySelector(`[data-icon="${icon}"]`)?.parentElement?.textContent ?? null;
  };

  test('shows the badge on a waiting row whose directory was never bootstrapped', async () => {
    // The host seed is how an unopened directory reaches the index.
    seedGlobalBlockingRequests([
      { sessionId: 'waiting', directory: '/repo', permissions: [permission('p1', 'waiting')], forms: [form('q1', 'waiting')] },
      { sessionId: 'asked', directory: '/repo', permissions: [], forms: [form('q2', 'asked')] },
    ]);
    const sessions = [session('quiet'), session('asked'), session('waiting')];
    const rows = rowsFor(sessions);
    const container = dom.document.createElement('div') as unknown as HTMLElement;
    dom.document.body.appendChild(container as never);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<RealRows rows={rows} />));

      // The waiting rows lead the zone, ahead of the Recent row.
      expect(rowIds(container)).toEqual(['asked', 'waiting', 'quiet']);
      // And each carries the request its directory store never loaded.
      expect(badgeNumber(container, 'waiting', 'shield')).toBe('1');
      expect(badgeNumber(container, 'waiting', 'question')).toBe('1');
      expect(badgeNumber(container, 'asked', 'question')).toBe('1');
      expect(badgeNumber(container, 'asked', 'shield')).toBeNull();
      expect(badgeNumber(container, 'quiet', 'shield')).toBeNull();
      expect(badgeNumber(container, 'quiet', 'question')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  test('counts a request that both feeds know exactly once', async () => {
    // Both the directory store and the index hold the same ask. Summing the
    // two feeds would show "2"; the row must show "1".
    const ask = permission('p1', 'waiting');
    seedGlobalBlockingRequests([{ sessionId: 'waiting', directory: '/repo', permissions: [ask], forms: [] }]);
    const sessions = [session('waiting')];
    const rows = rowsFor(sessions);
    const container = dom.document.createElement('div') as unknown as HTMLElement;
    dom.document.body.appendChild(container as never);
    const root = createRoot(container);

    // Fill the directory store the way a bootstrapped project row would.
    const Fill = () => {
      const manager = useChildStoreManager();
      React.useLayoutEffect(() => {
        manager.ensureChild('/repo', { bootstrap: false }).setState({ permission: { waiting: [{ ...ask }] } });
      }, [manager]);
      return null;
    };

    try {
      await act(async () => root.render(<RealRows rows={rows} fill={<Fill />} />));
      expect(badgeNumber(container, 'waiting', 'shield')).toBe('1');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
