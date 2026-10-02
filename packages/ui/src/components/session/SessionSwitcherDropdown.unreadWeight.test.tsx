import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/model';

const SESSION_ID = 'ses_switcher-dropdown-unread-weight';
const TITLE = 'Dropdown unread weight';

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

// The dropdown resolves its rows from every session store there is; this
// surface test pins the one row whose title weight it checks.
mock.module('@/components/session/sidebar/shell/useSwitcherItems', () => ({
  useSwitcherItems: () => [{
    node: { session, children: [], worktree: null },
    projectId: 'project',
    groupDirectory: '/workspace',
    secondaryMeta: { projectLabel: null, branchLabel: null },
  }],
  findSwitcherItemAncestorIds: () => null,
}));

// The dropdown pulls in the popup primitives and the icon sprite, so the
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

const { SessionSwitcherDropdown } = await import('./SessionSwitcherDropdown');
const { useUIStore } = await import('@/stores/useUIStore');
const { useNotificationStore } = await import('@/sync/notification-store');
const { useSessionUIStore } = await import('@/sync/session-ui-store');

const emptyNotificationIndex = () => ({
  session: { unseenCount: {}, unseenHasError: {} },
  project: { unseenCount: {}, unseenHasError: {} },
});

/** The leaf element that holds exactly the row's title text. The popup renders
    into a portal on the document, not under the test host. */
const titleElement = (): HTMLElement => {
  const match = [...document.querySelectorAll<HTMLElement>('span')].find(
    (element) => element.children.length === 0 && element.textContent === TITLE,
  );
  if (!match) throw new Error('dropdown row title is missing');
  return match;
};

describe('session switcher dropdown unread weight', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useNotificationStore.setState({ list: [], index: emptyNotificationIndex() });
    // No current session: the dropdown then leaves focus alone.
    useSessionUIStore.setState({ currentSessionId: null });
    useUIStore.setState({ isSessionDropdownOpen: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    useUIStore.setState({ isSessionDropdownOpen: false });
    useNotificationStore.setState({ list: [], index: emptyNotificationIndex() });
  });

  const renderDropdown = async () => {
    await act(async () => root.render(
      <I18nProvider>
        <SessionSwitcherDropdown>
          <button type="button">Sessions</button>
        </SessionSwitcherDropdown>
      </I18nProvider>,
    ));
  };

  test('bolds the row title while the result is unseen and returns it to regular once read', async () => {
    await renderDropdown();
    // Read: the row's own weight, no bold.
    expect(titleElement().classList.contains('font-normal')).toBe(true);
    expect(titleElement().classList.contains('font-medium')).toBe(false);

    // Unseen: the row is bold, the marker beside it adds no colour.
    await act(async () => useNotificationStore.getState().append({
      type: 'turn-complete',
      session: SESSION_ID,
      time: Date.now(),
      viewed: false,
    }));
    expect(titleElement().classList.contains('font-medium')).toBe(true);
    expect(titleElement().classList.contains('font-normal')).toBe(false);
    expect(document.querySelectorAll('[data-session-activity-indicator="unread"]')).toHaveLength(1);

    // Reading the session drops the emphasis again.
    await act(async () => useNotificationStore.getState().markSessionViewed(SESSION_ID));
    expect(titleElement().classList.contains('font-normal')).toBe(true);
    expect(titleElement().classList.contains('font-medium')).toBe(false);
  });
});
