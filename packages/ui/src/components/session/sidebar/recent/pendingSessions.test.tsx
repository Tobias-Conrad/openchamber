import { beforeEach, describe, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Session } from '@/lib/opencode/model';
import { I18nProvider } from '@/lib/i18n';
import {
  applyGlobalBlockingRequestEvents,
  resetGlobalBlockingRequests,
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
import { buildSessionSidebarRowModel, type SessionSidebarActivityItem, type SessionSidebarRowModelArgs } from '../sessionSidebarRowModel';
import { installHookTestDom } from '../test-utils/testDom';

// The sprite-injecting icon is a presentational leaf; the badge assertions care
// about which badge rendered, so it renders as a marker element here.
mock.module('@/components/icon/Icon', () => ({
  Icon: ({ name, className }: { name: string; className?: string }) => (
    <svg className={className} data-icon={name} aria-hidden="true" />
  ),
}));

const { PendingRequestBadges } = await import('../sessions/PendingRequestBadges');
const { SessionSidebarActivityHeader } = await import('../sessionSidebarHeaderPresentation');

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

  test('renders the waiting row as the first zone row with its badge, with the switch off', async () => {
    const dom = installHookTestDom();
    const root = createRoot(dom.container);
    applyGlobalBlockingRequestEvents('/repo', [
      { type: 'permission.asked', properties: permission('p1', 'waiting') },
      { type: 'form.created', properties: { form: { ...form('q1', 'asked'), fields: [{ key: 'answer', type: 'boolean' }] } } },
    ]);
    const sessions = [session('quiet'), session('asked'), session('waiting')];
    let zoneHeaderRow: unknown = null;
    let idsWithoutRecent: string[] = [];
    let idsWithRecent: string[] = [];
    let waitingBadges: Array<{ permissions: number; forms: number }> = [];

    const Harness = () => {
      const bySession = useGlobalBlockingRequestsStore((state) => state.bySession);
      const pendingSessionIds = React.useMemo(() => selectPendingSessionIds(bySession), [bySession]);
      const waitingItems = derivePendingActivityItems({
        sessions, pendingSessionIds, getSessionLocation: () => null, query: '',
      });
      const recentItems = deriveRecentActivitySections({
        sessions: [session('quiet')], getSessionLocation: () => null, query: '',
      })[0]?.items ?? [];
      const sections = sectionsOf(mergeActivityItems(waitingItems, recentItems));
      const idsOf = (showRecentSection: boolean) => buildSessionSidebarRowModel(rowArgs(sections, showRecentSection)).rows
        .flatMap((row) => (row.kind === 'session' ? [row.node.session.id] : []));
      const offModel = buildSessionSidebarRowModel(rowArgs(sections, false));
      zoneHeaderRow = offModel.rows[0];
      idsWithoutRecent = idsOf(false);
      idsWithRecent = idsOf(true);
      waitingBadges = offModel.rows.flatMap((row) => {
        if (row.kind !== 'session') return [];
        const pending = bySession.get(row.node.session.id);
        return [{ permissions: pending?.permissions.length ?? 0, forms: pending?.forms.length ?? 0 }];
      });
      return <>
        {/* The zone header and its rows are mounted although the Recent switch is off. */}
        <SessionSidebarActivityHeader
          activityKey="active-now"
          collapsed={false}
          forceExpanded={false}
          alwaysShowActions={false}
          onToggle={() => undefined}
          onNewChat={() => undefined}
        />
        {offModel.rows.flatMap((row) => {
          if (row.kind !== 'session') return [];
          const pending = bySession.get(row.node.session.id);
          return [<PendingRequestBadges
            key={row.key}
            permissionCount={pending?.permissions.length ?? 0}
            formCount={pending?.forms.length ?? 0}
          />];
        })}
      </>;
    };

    try {
      await act(async () => root.render(<I18nProvider><Harness /></I18nProvider>));

      // The zone header is rendered although showRecentSection is false, the
      // waiting rows lead it, and the quiet Recent row only follows them once
      // the switch is on.
      expect(zoneHeaderRow).toMatchObject({ kind: 'activity-header', activityKey: 'active-now' });
      expect(idsWithoutRecent).toEqual(['asked', 'waiting']);
      expect(idsWithRecent).toEqual(['asked', 'waiting', 'quiet']);
      // Each waiting row carries the counts of its own request.
      expect(waitingBadges).toEqual([{ permissions: 0, forms: 1 }, { permissions: 1, forms: 0 }]);
    } finally {
      await act(async () => root.unmount());
      dom.restore();
    }

    const badgeHtml = renderToStaticMarkup(<I18nProvider>
      <PendingRequestBadges permissionCount={waitingBadges[1]?.permissions ?? 0} formCount={waitingBadges[1]?.forms ?? 0} />
    </I18nProvider>);

    expect(badgeHtml).toContain('data-icon="shield"');
    expect(badgeHtml).toContain('Permission required');
  });
});
