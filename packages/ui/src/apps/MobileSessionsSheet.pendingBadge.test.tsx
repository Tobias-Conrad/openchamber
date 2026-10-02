import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/model';

// The row reads its waiting counts from the cross-directory request index; the
// mock pins them so the test is about where the badge lands, not about the
// index. A permission is present too, so "the question moved but the shield
// stayed" is observable.
mock.module('./usePendingRequestCounts', () => ({
  usePendingRequestCounts: () => ({ permissionCount: 1, formCount: 2 }),
}));

// The rename action reaches into the sync runtime, which this row test has no
// provider for; it is irrelevant to where the badges land.
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
const { SessionRow } = await import('./MobileSessionsSheet');

const SESSION_ID = 'ses_question-priority';
const TITLE = 'Question priority row';

// SAFETY: the fixture covers every field the row reads; `metadata` carries the
// active goal the row's glyph renders.
const session = {
  id: SESSION_ID,
  projectID: 'project',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  title: TITLE,
  directory: '/workspace',
  time: { created: 1, updated: 1 },
  metadata: {
    openchamber: {
      goal: {
        id: 'goal-1',
        objective: 'Show the question first',
        objectiveFile: false,
        status: 'active',
        tokenBudget: null,
        tokensUsed: 0,
        turnsUsed: 0,
        statusReason: '',
        evaluationProviderID: '',
        evaluationModelID: '',
        lastAccountedMessageID: '',
        createdAt: 1,
        updatedAt: 1,
      },
    },
  },
} as Session;

/** The leaf element that holds exactly the title text, not one of its containers. */
const titleElement = (host: HTMLElement): HTMLElement => {
  const match = [...host.querySelectorAll<HTMLElement>('span')].find(
    (element) => element.children.length === 0 && element.textContent === TITLE,
  );
  if (!match) throw new Error('title is missing');
  return match;
};

const questionBadge = (host: HTMLElement): HTMLElement => {
  const badge = host.querySelector<HTMLElement>('[data-session-question-badge]');
  if (!badge) throw new Error('question badge is missing');
  return badge;
};

describe('mobile session row pending question', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useGlobalSessionStatusStore.setState({ activeSessionIds: new Set() });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    useGlobalSessionStatusStore.setState({ activeSessionIds: new Set() });
  });

  const renderRow = async () => {
    await act(async () => root.render(
      <I18nProvider>
        <SessionRow
          session={session}
          active={false}
          indent={0}
          onSelect={() => undefined}
          pin={{ pinned: true, onToggle: () => undefined }}
        />
      </I18nProvider>,
    ));
  };

  test('leads the title with the question although the row is pinned, has a goal and is running', async () => {
    useGlobalSessionStatusStore.setState({ activeSessionIds: new Set([SESSION_ID]) });
    await renderRow();

    expect(host.querySelectorAll('[data-session-question-badge]')).toHaveLength(1);
    const badge = questionBadge(host);
    expect(badge.getAttribute('aria-label')).toBe('2 pending questions');

    // The leading question badge is amber, matching the desktop leading marker,
    // so it is never mistaken for a running (green) turn.
    expect(badge.classList.contains('text-status-warning')).toBe(true);
    expect(badge.classList.contains('text-status-info')).toBe(false);
    expect(badge.classList.contains('text-status-success')).toBe(false);

    // The question sits before the title, not squeezed into the trailing
    // metadata cluster.
    const title = titleElement(host);
    expect(title.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    // Nothing else was pushed off the row: the pin, the goal glyph and the
    // running marker are all still there.
    expect(host.querySelector('[aria-label="Pinned session"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Active"]')).not.toBeNull();
    expect(host.querySelector('[data-session-activity-indicator="running"]')).not.toBeNull();
  });

  test('shows the question once, and keeps only the permission shield trailing', async () => {
    await renderRow();

    expect(host.querySelectorAll('[data-session-question-badge]')).toHaveLength(1);
    const badge = questionBadge(host);

    const shield = host.querySelector<HTMLElement>('[aria-label="Permission required"]');
    if (!shield) throw new Error('permission shield is missing');
    expect(shield.hasAttribute('data-session-question-badge')).toBe(false);

    // The shield follows the title — the question is the only leading badge.
    const title = titleElement(host);
    expect(title.compareDocumentPosition(shield) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Nothing question-shaped trails the title: the leading badge is not
    // duplicated in the metadata cluster.
    const trailingQuestions = [...host.querySelectorAll<HTMLElement>('[data-session-question-badge]')]
      .filter((element) => (title.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    expect(trailingQuestions).toHaveLength(0);
    expect(badge.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
