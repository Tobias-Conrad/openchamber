import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/model';

// No waiting request here: this test is about the unread signal alone.
mock.module('./usePendingRequestCounts', () => ({
  usePendingRequestCounts: () => ({ permissionCount: 0, formCount: 0 }),
}));

// The rename action reaches into the sync runtime, which this row test has no
// provider for; it does not touch the title's weight.
mock.module('@/components/session/useSessionAiRenameAction', () => ({
  useSessionAiRenameAction: () => ({ pending: false, disabled: true, hint: '', run: () => undefined }),
}));

// The sheet pulls in the whole mobile tree, so the browser globals have to
// exist before that module graph is evaluated.
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
const { SessionRow } = await import('./MobileSessionsSheet');

const SESSION_ID = 'ses_mobile-unread-weight';
const TITLE = 'Unread weight row';

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

const emptyNotificationIndex = () => ({
  session: { unseenCount: {}, unseenHasError: {} },
  project: { unseenCount: {}, unseenHasError: {} },
});

/** The leaf element that holds exactly the title text, not one of its containers. */
const titleElement = (host: HTMLElement): HTMLElement => {
  const match = [...host.querySelectorAll<HTMLElement>('span')].find(
    (element) => element.children.length === 0 && element.textContent === TITLE,
  );
  if (!match) throw new Error('title is missing');
  return match;
};

describe('mobile session row unread weight', () => {
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
        <SessionRow
          session={session}
          active={false}
          indent={0}
          onSelect={() => undefined}
        />
      </I18nProvider>,
    ));
  };

  test('bolds the title while the result is unseen and keeps the dot as the second cue', async () => {
    await renderRow();
    const title = titleElement(host);
    expect(title.classList.contains('font-medium')).toBe(false);
    // Nothing waits on the user, so no status colour is on the title either.
    expect(title.classList.contains('text-status-warning')).toBe(false);
    expect(title.classList.contains('text-status-success')).toBe(false);

    await act(async () => useNotificationStore.getState().append({
      type: 'turn-complete',
      session: SESSION_ID,
      time: Date.now(),
      viewed: false,
    }));

    // Unread is weight plus the unread dot, never colour.
    expect(title.classList.contains('font-medium')).toBe(true);
    expect(title.classList.contains('text-foreground')).toBe(true);
    expect(host.querySelector('[data-session-activity-indicator="unread"]')).not.toBeNull();

    // Reading the session drops the emphasis again.
    await act(async () => useNotificationStore.getState().markSessionViewed(SESSION_ID));
    expect(titleElement(host).classList.contains('font-medium')).toBe(false);
  });
});
