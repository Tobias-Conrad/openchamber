import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/model';

const SESSION_ID = 'ses_mobile-switcher-unread-weight';
const TITLE = 'Switcher unread weight';

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

// The switcher refreshes the global list when it opens, and its rows are
// resolved from every store there is; this surface test keeps the network out
// and pins the one row it cares about.
const actualGlobalSessionsStore = await import('@/stores/useGlobalSessionsStore');
mock.module('@/stores/useGlobalSessionsStore', () => ({
  ...actualGlobalSessionsStore,
  refreshGlobalSessions: () => Promise.resolve(),
}));
mock.module('@/components/session/sidebar/shell/useSwitcherItems', () => ({
  useSwitcherItems: () => [{
    node: { session, children: [], worktree: null },
    projectId: 'project',
    groupDirectory: '/workspace',
    secondaryMeta: { projectLabel: null, branchLabel: null },
  }],
  findSwitcherItemAncestorIds: () => null,
}));

// The switcher pulls in the icon sprite and the whole mobile tree, so the
// browser globals have to exist before that module graph is evaluated.
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

const { MobileSessionSwitcher } = await import('./MobileSessionSwitcher');
const { useNotificationStore } = await import('@/sync/notification-store');
const { useSessionUIStore } = await import('@/sync/session-ui-store');
const { ThemeSystemProvider } = await import('@/contexts/ThemeSystemContext');

const noop = () => undefined;

const emptyNotificationIndex = () => ({
  session: { unseenCount: {}, unseenHasError: {} },
  project: { unseenCount: {}, unseenHasError: {} },
});

/** The leaf element that holds exactly the row's title text. */
const titleElement = (host: HTMLElement): HTMLElement => {
  const match = [...host.querySelectorAll<HTMLElement>('span')].find(
    (element) => element.children.length === 0 && element.textContent === TITLE,
  );
  if (!match) throw new Error('switcher title is missing');
  return match;
};

describe('mobile session switcher unread weight', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useNotificationStore.setState({ list: [], index: emptyNotificationIndex() });
    useSessionUIStore.setState({ currentSessionId: null });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    useNotificationStore.setState({ list: [], index: emptyNotificationIndex() });
  });

  const renderSwitcher = async () => {
    await act(async () => root.render(
      <ThemeSystemProvider>
        <I18nProvider>
          <MobileSessionSwitcher open onClose={noop} anchorRef={React.createRef<HTMLElement>()} />
        </I18nProvider>
      </ThemeSystemProvider>,
    ));
  };

  test('bolds the switcher row title while the result is unseen and returns it to regular once read', async () => {
    await renderSwitcher();
    // The read state keeps the row's own weight; unread adds the bold on top.
    expect(titleElement(host).classList.contains('font-medium')).toBe(false);

    // A turn finished and was never seen: the row's marker carries no status
    // colour for "unseen" any more, so the weight has to say it.
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
