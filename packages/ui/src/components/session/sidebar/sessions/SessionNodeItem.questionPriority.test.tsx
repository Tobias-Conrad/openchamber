import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/model';
import type { SessionNodeItemProps } from './SessionNodeItem';
import type { SessionNode } from '../types';

const SESSION_ID = 'ses_desktop-question-priority';
const TITLE = 'Desktop question priority row';

// The row's decision inputs, pinned so the test is about the marker slot, not
// about the sync store: two questions are waiting.
mock.module('@/sync/sync-context', () => ({
  setActiveSession: () => undefined,
  useChildStoreManager: () => null,
  useDirectoryStore: () => null,
  useGlobalSessionStatus: () => null,
  useSessionPermissions: () => [],
  useSessionFormCount: () => 2,
  useSyncSDK: () => null,
  useSyncDirectory: () => null,
  buildSessionMessageRecordsSnapshot: () => [],
  useSyncRuntime: () => ({ runtimeKey: 'test', childStores: null, messageLoader: null }),
}));
mock.module('@/sync/use-sync', () => ({
  usePrefetchSessionMessages: () => () => undefined,
  useSessionMessageRecordsForExport: () => () => [],
}));
mock.module('@/sync/use-session-ai-rename', () => ({
  useIsSessionAiRenamePending: () => false,
  useSessionAiRename: () => ({ prepare: async () => ({ turns: [] }), rename: async () => undefined }),
}));
mock.module('@/hooks/useGuestSurfaces', () => ({ useGuestActions: () => [] }));
mock.module('@/components/session/SessionAiRenameMenuItem', () => ({ SessionAiRenameMenuItem: () => null }));

// The row pulls in the sidebar's whole module graph; the browser globals have
// to exist before that is evaluated.
const dom = new Window({ url: 'http://localhost' });
const globals = {
  window: dom,
  document: dom.document,
  navigator: dom.navigator,
  localStorage: dom.localStorage,
  Element: dom.Element,
  HTMLElement: dom.HTMLElement,
  Node: dom.Node,
  Event: dom.Event,
  MouseEvent: dom.MouseEvent,
  MutationObserver: dom.MutationObserver,
  ResizeObserver: dom.ResizeObserver,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  IS_REACT_ACT_ENVIRONMENT: true,
};
for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

const { useGlobalSessionStatusStore } = await import('@/sync/global-session-status');
const { useNotificationStore } = await import('@/sync/notification-store');
const { getPinnedSessionKey } = await import('@/stores/useSessionPinnedStore');
const { getRuntimeKey } = await import('@/lib/runtime-switch');
const { SessionNodeItem } = await import('./SessionNodeItem');

// Pins are keyed by runtime + normalized directory + session id, not by the
// bare id: the fixture has to build the same key or the row is not pinned at
// all (which is how the pin assertions below can tell).
const PINNED_SESSION_KEY = getPinnedSessionKey(getRuntimeKey(), '/workspace', SESSION_ID) ?? SESSION_ID;

const emptyNotificationIndex = () => ({
  session: { unseenCount: {}, unseenHasError: {} },
  project: { unseenCount: {}, unseenHasError: {} },
});

const noop = () => undefined;

// SAFETY: the fixture covers every field the row reads.
const session = {
  id: SESSION_ID,
  projectID: 'project',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  title: TITLE,
  directory: '/workspace',
  time: { created: 1, updated: 1 },
} as Session;

const node = { session, children: [], worktree: null } satisfies SessionNode;

const createProps = (): SessionNodeItemProps => ({
  node,
  depth: 0,
  groupDirectory: '/workspace',
  projectId: 'project',
  folderOwnerKey: null,
  selectionScopeKey: 'project',
  archivedBucket: false,
  pinnedSessionIds: new Set([PINNED_SESSION_KEY]),
  expandedParents: new Set(),
  hasSessionSearchQuery: false,
  normalizedSessionSearchQuery: '',
  notifyOnSubtasks: false,
  editingId: null,
  editingRowKey: null,
  setEditingId: noop,
  setEditingRowKey: noop,
  editTitle: '',
  setEditTitle: noop,
  handleSaveEdit: noop,
  handleCancelEdit: noop,
  toggleParent: noop,
  handleSessionSelect: noop,
  handleSessionDoubleClick: noop,
  handleCopySessionId: noop,
  openSidebarMenuKey: null,
  setOpenSidebarMenuKey: noop,
  createFolderAndStartRename: () => null,
  handleDeleteSession: noop,
  handleRestoreSession: noop,
  startSessionWorktreeMenuLoad: () => ({ cachedTargets: [], refreshTargets: Promise.resolve([]) }),
  mobileVariant: false,
  alwaysShowActions: false,
  subtreeContainsEditing: new Set(),
  menuOpenSessionId: null,
  nodeStructureKey: 'node',
  relativeTimeTick: 0,
});

/** The leaf element that holds exactly the title text, not one of its containers. */
const titleElement = (host: HTMLElement): HTMLElement => {
  const match = [...host.querySelectorAll<HTMLElement>('div, span')].find(
    (element) => element.children.length === 0 && element.textContent === TITLE,
  );
  if (!match) throw new Error('title is missing');
  return match;
};

const questionMarker = (host: HTMLElement): HTMLElement => {
  const marker = host.querySelector<HTMLElement>('[data-session-question-marker="leading"]');
  if (!marker) throw new Error('leading question marker is missing');
  return marker;
};

/** The pin glyph; the label is the one the row sets on it. */
const pinnedMarker = (host: HTMLElement): HTMLElement => {
  const marker = host.querySelector<HTMLElement>('[aria-label="Pinned session"]');
  if (!marker) throw new Error('pin marker is missing');
  return marker;
};

describe('desktop session row pending question', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useGlobalSessionStatusStore.setState({ activeSessionIds: new Set() });
    useNotificationStore.setState({ list: [], index: emptyNotificationIndex() });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    useGlobalSessionStatusStore.setState({ activeSessionIds: new Set() });
    useNotificationStore.setState({ list: [], index: emptyNotificationIndex() });
  });

  const renderRow = async () => {
    await act(async () => root.render(
      <I18nProvider>
        <SessionNodeItem {...createProps()} />
      </I18nProvider>,
    ));
  };

  test('the waiting question takes the leading slot although the row is pinned and running', async () => {
    // Running and pinned are both active; the question must still win.
    useGlobalSessionStatusStore.setState({ activeSessionIds: new Set([SESSION_ID]) });
    await renderRow();

    expect(host.querySelectorAll('[data-session-question-marker="leading"]')).toHaveLength(1);
    const marker = questionMarker(host);
    expect(marker.getAttribute('aria-label')).toBe('2 pending questions');
    // The waiting question is amber and carries no other status tone, so it can
    // never be read as a running (green) turn.
    expect(marker.classList.contains('text-status-warning')).toBe(true);
    expect(marker.classList.contains('text-status-info')).toBe(false);
    expect(marker.classList.contains('text-status-success')).toBe(false);

    // It leads the title.
    const title = titleElement(host);
    expect(title.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(marker.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The pin retires behind the question instead of disappearing: the row is
    // pinned AND waiting, and both facts still show. The question badge comes
    // first in the leading area, the pin right after it.
    const pin = pinnedMarker(host);
    expect(host.querySelectorAll('[aria-label="Pinned session"]')).toHaveLength(1);
    expect(marker.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pin.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    // The question took the slot from the running marker: although the turn
    // runs, no activity indicator is left anywhere on the row, so the question
    // cannot be read as "still working" (guard, not the fix itself).
    expect(host.querySelectorAll('[data-session-activity-indicator]')).toHaveLength(0);
  });

  test('shows the question only once, never again in the trailing badges', async () => {
    await renderRow();

    expect(host.querySelectorAll('[data-session-question-marker="leading"]')).toHaveLength(1);
    expect(host.querySelectorAll('[aria-label="2 pending questions"]')).toHaveLength(1);
    // The hook the mobile row uses is now on the desktop trailing badge too
    // (timeline rows render exactly one, see the timeline test below), so this
    // zero is a real result instead of a selector that can never match.
    expect(host.querySelectorAll('[data-session-question-badge]')).toHaveLength(0);

    // The trailing cluster carries no question badge at all.
    const title = titleElement(host);
    const trailingQuestions = [...host.querySelectorAll<HTMLElement>('[aria-label="2 pending questions"]')]
      .filter((element) => (title.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    expect(trailingQuestions).toHaveLength(0);
  });

  test('keeps the question badge on timeline rows, which have no leading slot', async () => {
    await act(async () => root.render(
      <I18nProvider>
        <SessionNodeItem {...createProps()} renderContext="timeline" alwaysShowActions />
      </I18nProvider>,
    ));

    // No leading slot exists there, so the question must stay trailing — and
    // exactly once: the row asks the same question once, not twice.
    expect(host.querySelectorAll('[data-session-question-marker="leading"]')).toHaveLength(0);
    expect(host.querySelectorAll('[aria-label="2 pending questions"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-session-question-badge]')).toHaveLength(1);
  });

  test('bolds the title while the result is unseen and returns it to normal once read', async () => {
    const titleClasses = (): DOMTokenList => titleElement(host).classList;

    await renderRow();
    expect(titleClasses().contains('font-normal')).toBe(true);
    expect(titleClasses().contains('font-medium')).toBe(false);

    // A turn finished and was never seen: weight, not colour, marks it.
    await act(async () => useNotificationStore.getState().append({
      type: 'turn-complete',
      session: SESSION_ID,
      time: Date.now(),
      viewed: false,
    }));
    expect(titleClasses().contains('font-medium')).toBe(true);
    expect(titleClasses().contains('font-normal')).toBe(false);

    // Reading the session drops the emphasis again.
    await act(async () => useNotificationStore.getState().markSessionViewed(SESSION_ID));
    expect(titleClasses().contains('font-normal')).toBe(true);
    expect(titleClasses().contains('font-medium')).toBe(false);
  });

  test('bolds the timeline row title while the result is unseen, like the project row', async () => {
    // The timeline row renders through SessionTimelineRowBody, whose title
    // weight is owned by the caller. Before the fix its title stayed
    // `font-normal`, so the unread assertion below fails red.
    await act(async () => root.render(
      <I18nProvider>
        <SessionNodeItem {...createProps()} renderContext="timeline" alwaysShowActions />
      </I18nProvider>,
    ));

    const titleClasses = (): DOMTokenList => titleElement(host).classList;
    expect(titleClasses().contains('font-normal')).toBe(true);
    expect(titleClasses().contains('font-medium')).toBe(false);

    await act(async () => useNotificationStore.getState().append({
      type: 'turn-complete',
      session: SESSION_ID,
      time: Date.now(),
      viewed: false,
    }));
    expect(titleClasses().contains('font-medium')).toBe(true);
    expect(titleClasses().contains('font-normal')).toBe(false);

    await act(async () => useNotificationStore.getState().markSessionViewed(SESSION_ID));
    expect(titleClasses().contains('font-normal')).toBe(true);
    expect(titleClasses().contains('font-medium')).toBe(false);
  });
});
