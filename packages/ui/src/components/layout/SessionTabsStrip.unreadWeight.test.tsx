import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/model';

// The tab strip reads the working set and the live sessions from their stores;
// the multi-run membership is unrelated to the title's weight.
mock.module('@/lib/multirun/useMultiRuns', () => ({
  useMultiRunMemberIds: () => [],
}));

// The rename hook wants the sync runtime provider, which this surface test does
// not mount; it has nothing to do with the title's weight.
mock.module('@/sync/use-session-ai-rename', () => ({
  useIsSessionAiRenamePending: () => false,
  useSessionAiRename: () => ({ prepare: async () => ({ turns: [] }), rename: async () => undefined }),
}));

// The strip pulls in dnd-kit and the icon sprite, so the browser globals have
// to exist before that module graph is evaluated.
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

const { SessionTabsStrip } = await import('@/components/layout/SessionTabsStrip');
const { useSessionTabsStore } = await import('@/stores/useSessionTabsStore');
const { useGlobalSessionsStore } = await import('@/stores/useGlobalSessionsStore');
const { useSessionUIStore } = await import('@/sync/session-ui-store');
const { useNotificationStore } = await import('@/sync/notification-store');

const SESSION_ID = 'ses_tab-unread-weight';
const TITLE = 'Tab unread weight';

// SAFETY: the fixture covers every field the tab reads.
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

/** The leaf element that holds exactly the tab's title text. */
const titleElement = (host: HTMLElement): HTMLElement => {
  const match = [...host.querySelectorAll<HTMLElement>('span')].find(
    (element) => element.children.length === 0 && element.textContent === TITLE,
  );
  if (!match) throw new Error('tab title is missing');
  return match;
};

describe('session tab unread weight', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useNotificationStore.setState({ list: [], index: emptyNotificationIndex() });
    // The tab renders its own title only while it is not the current session.
    useSessionUIStore.setState({ currentSessionId: null });
    useGlobalSessionsStore.setState({ activeSessions: [session], archivedSessions: [] });
    useSessionTabsStore.setState({ tabIds: [SESSION_ID] });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    useNotificationStore.setState({ list: [], index: emptyNotificationIndex() });
    useGlobalSessionsStore.setState({ activeSessions: [], archivedSessions: [] });
    useSessionTabsStore.setState({ tabIds: [] });
  });

  const renderStrip = async () => {
    await act(async () => root.render(
      <I18nProvider>
        <SessionTabsStrip renderMenu={() => null}>
          <span>Active tab</span>
        </SessionTabsStrip>
      </I18nProvider>,
    ));
  };

  test('bolds the tab title while its result is unseen and returns it to regular once read', async () => {
    await renderStrip();
    expect(titleElement(host).classList.contains('font-normal')).toBe(true);
    expect(titleElement(host).classList.contains('font-medium')).toBe(false);

    // A turn finished and was never seen: the tab's dot alone no longer carries
    // the signal, so the weight has to.
    await act(async () => useNotificationStore.getState().append({
      type: 'turn-complete',
      session: SESSION_ID,
      time: Date.now(),
      viewed: false,
    }));
    expect(titleElement(host).classList.contains('font-medium')).toBe(true);
    expect(titleElement(host).classList.contains('font-normal')).toBe(false);
    expect(host.querySelector('[data-session-activity-indicator="unread"]')).not.toBeNull();

    // Reading the session drops the emphasis again.
    await act(async () => useNotificationStore.getState().markSessionViewed(SESSION_ID));
    expect(titleElement(host).classList.contains('font-normal')).toBe(true);
    expect(titleElement(host).classList.contains('font-medium')).toBe(false);
  });
});
