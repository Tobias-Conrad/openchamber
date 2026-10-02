import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/model';

// The rows read their waiting counts from the cross-directory request index;
// the mock pins them so the test is about the block's membership and order, not
// about the index. Both halves are present, so the shield stays with the
// trailing metadata while the question leads the title.
mock.module('./usePendingRequestCounts', () => ({
  usePendingRequestCounts: () => ({ permissionCount: 1, formCount: 2 }),
}));

// The rename action reaches into the sync runtime, which this row test has no
// provider for; it is irrelevant to the block.
mock.module('@/components/session/useSessionAiRenameAction', () => ({
  useSessionAiRenameAction: () => ({ pending: false, disabled: true, hint: '', run: () => undefined }),
}));

// The sheet's module pulls in the whole mobile tree, so the browser globals
// have to exist before that graph is evaluated.
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
const { MobileWaitingSessionsSection } = await import('./MobileSessionsSheet');

// SAFETY: the fixtures cover every field a row reads.
const session = (id: string, title: string): Session => ({
  id,
  projectID: 'project',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  title,
  directory: '/workspace',
  time: { created: 1, updated: 1 },
}) as Session;

/** The leaf elements that hold a row's title text, in document order. */
const titles = (host: HTMLElement): string[] => [...host.querySelectorAll<HTMLElement>('span')]
  .filter((element) => element.children.length === 0 && ['Waiting first', 'Waiting second'].includes(element.textContent ?? ''))
  .map((element) => element.textContent ?? '');

describe('mobile waiting zone', () => {
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

  const renderSection = async (sessions: Session[]) => {
    await act(async () => root.render(
      <I18nProvider>
        <MobileWaitingSessionsSection
          sessions={sessions}
          activeSessionId={null}
          contextLabelOf={() => 'Project'}
          onSelect={() => undefined}
          descendantIdsOf={() => []}
        />
      </I18nProvider>,
    ));
  };

  test('shows no block at all while nothing waits', async () => {
    await renderSection([]);
    expect(host.querySelector('[data-mobile-waiting-zone]')).toBeNull();
    expect(host.textContent).not.toContain('Waiting for you');
  });

  test('leads with the block and renders the waiting rows in the given order', async () => {
    await renderSection([session('ses_first', 'Waiting first'), session('ses_second', 'Waiting second')]);

    const zone = host.querySelector('[data-mobile-waiting-zone]');
    if (!zone) throw new Error('waiting zone is missing');
    expect(host.textContent).toContain('Waiting for you');
    expect(titles(host)).toEqual(['Waiting first', 'Waiting second']);

    // The rows are the ordinary SessionRow: each carries the question badge the
    // block promised, so the leading block and the list can never disagree.
    expect(zone.querySelectorAll('[data-session-question-badge]')).toHaveLength(2);
  });
});
