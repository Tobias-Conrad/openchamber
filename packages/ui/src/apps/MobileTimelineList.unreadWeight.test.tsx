import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/model';
import type { TimelineEntry, TimelineRowHandlers } from './MobileTimelineList';

// No waiting request here: this test is about the unread signal alone.
mock.module('./usePendingRequestCounts', () => ({
  usePendingRequestCounts: () => ({ permissionCount: 0, formCount: 0 }),
}));

// The rename action reaches into the sync runtime, which this row test has no
// provider for; it does not touch the title's weight.
mock.module('@/components/session/useSessionAiRenameAction', () => ({
  useSessionAiRenameAction: () => ({ pending: false, disabled: true, hint: '', run: () => undefined }),
}));

// The row pulls in the swipe surface, the icon sprite and the mobile tree, so
// the browser globals have to exist before that module graph is evaluated.
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

const { MobileTimelineList } = await import('./MobileTimelineList');
const { useGlobalSessionStatusStore } = await import('@/sync/global-session-status');
const { useNotificationStore } = await import('@/sync/notification-store');
const { ThemeSystemProvider } = await import('@/contexts/ThemeSystemContext');

const SESSION_ID = 'ses_timeline-unread-weight';
const TITLE = 'Timeline unread weight';

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

const entry: TimelineEntry = {
  kind: 'session',
  session,
  project: { id: 'project', label: 'Project' },
  branch: null,
};

const noop = () => undefined;

const handlers: TimelineRowHandlers = {
  currentSessionId: null,
  revealedSessionId: null,
  confirmingDeleteSessionId: null,
  renamingSessionId: null,
  onSelect: noop,
  onRevealedChange: noop,
  onArchive: noop,
  onRequestDelete: noop,
  onConfirmDelete: noop,
  onRequestRename: noop,
  onSubmitRename: noop,
  onCancelRename: noop,
  isPinned: () => false,
  onTogglePin: noop,
  descendantIdsOf: () => [],
};

const emptyNotificationIndex = () => ({
  session: { unseenCount: {}, unseenHasError: {} },
  project: { unseenCount: {}, unseenHasError: {} },
});

/** The leaf element that holds exactly the row's title text. */
const titleElement = (host: HTMLElement): HTMLElement => {
  const match = [...host.querySelectorAll<HTMLElement>('span')].find(
    (element) => element.children.length === 0 && element.textContent === TITLE,
  );
  if (!match) throw new Error('timeline title is missing');
  return match;
};

describe('mobile timeline row unread weight', () => {
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

  const renderList = async () => {
    await act(async () => root.render(
      <ThemeSystemProvider>
        <I18nProvider>
          <MobileTimelineList
            entries={[entry]}
            visibleCount={1}
            onRevealMore={noop}
            scrollRootRef={React.createRef<HTMLElement>()}
            handlers={handlers}
          />
        </I18nProvider>
      </ThemeSystemProvider>,
    ));
  };

  test('bolds the timeline title while the result is unseen and returns it to regular once read', async () => {
    await renderList();
    // The read state keeps the row's own weight; unread adds the bold on top.
    expect(titleElement(host).classList.contains('font-medium')).toBe(false);

    // A turn finished and was never seen: the row's marker is grey now, so the
    // weight is what says "unseen".
    await act(async () => useNotificationStore.getState().append({
      type: 'turn-complete',
      session: SESSION_ID,
      time: Date.now(),
      viewed: false,
    }));
    expect(titleElement(host).classList.contains('font-medium')).toBe(true);
    expect(host.querySelector('[data-session-activity-indicator="unread"]')).not.toBeNull();

    // Reading the session drops the emphasis again.
    await act(async () => useNotificationStore.getState().markSessionViewed(SESSION_ID));
    expect(titleElement(host).classList.contains('font-medium')).toBe(false);
  });
});
