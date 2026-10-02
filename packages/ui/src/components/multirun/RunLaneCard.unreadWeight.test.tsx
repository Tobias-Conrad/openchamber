import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/model';
import type { RunLaneCardProps } from './RunLaneCard';

// The card pulls in the icon sprite, the tooltip primitives and the provider
// logo, so the browser globals have to exist before that module graph is
// evaluated.
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

const { RunLaneCard } = await import('./RunLaneCard');

const MODEL_LABEL = 'Lane model';

// SAFETY: the fixture covers every field the card reads.
const session = {
  id: 'ses_lane-card-unread-weight',
  projectID: 'project',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  title: 'Lane session',
  directory: '/workspace',
  time: { created: 1, updated: 1, idle: 2 },
} as Session;

const noop = () => undefined;

const createProps = (unread: boolean): RunLaneCardProps => ({
  session,
  providerID: 'openai',
  modelLabel: MODEL_LABEL,
  variantLabel: null,
  isFusion: false,
  busy: false,
  status: 'finished',
  unread,
  summary: undefined,
  fuseSource: null,
  hasWorktree: false,
  onToggleFuseSource: noop,
  onKeep: undefined,
  onDetach: noop,
  onArchive: noop,
  actionsDisabled: false,
  onOpenChat: noop,
  onOpenDiff: noop,
});

/** The leaf element that holds exactly the lane's title text. */
const modelLabelElement = (host: HTMLElement): HTMLElement => {
  const match = [...host.querySelectorAll<HTMLElement>('span')].find(
    (element) => element.children.length === 0 && element.textContent === MODEL_LABEL,
  );
  if (!match) throw new Error('model label is missing');
  return match;
};

describe('run lane card unread weight', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const renderCard = async (unread: boolean) => {
    await act(async () => root.render(
      <I18nProvider>
        <RunLaneCard {...createProps(unread)} />
      </I18nProvider>,
    ));
  };

  test('bolds the lane title while its result is unseen, and only then', async () => {
    await renderCard(false);
    expect(modelLabelElement(host).classList.contains('font-normal')).toBe(true);
    expect(modelLabelElement(host).classList.contains('font-medium')).toBe(false);
    // Nothing unseen: the card carries no unread marker either.
    expect(host.querySelectorAll('[data-session-activity-indicator="unread"]')).toHaveLength(0);

    await renderCard(true);
    // Unread is the title's weight; the marker beside it no longer carries a
    // status colour of its own (see SessionActivityIndicator).
    expect(modelLabelElement(host).classList.contains('font-medium')).toBe(true);
    expect(modelLabelElement(host).classList.contains('font-normal')).toBe(false);
    expect(host.querySelectorAll('[data-session-activity-indicator="unread"]')).toHaveLength(1);

    await renderCard(false);
    expect(modelLabelElement(host).classList.contains('font-normal')).toBe(true);
    expect(modelLabelElement(host).classList.contains('font-medium')).toBe(false);
  });
});
