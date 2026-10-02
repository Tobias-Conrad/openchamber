import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { LaneStatus } from '@/lib/multirun/laneStatus';
import { LaneStatusIcon } from './LaneStatusIcon';

// One vocabulary for the whole app: green = the lane runs, amber = it waits on
// the user or ended without an answer, red = a decision or a real failure,
// grey = a flat fact. These assertions are the contract; without the palette
// change `question` renders blue and `working` renders amber, so the two rows
// below fail red before the fix.
describe('LaneStatusIcon colour vocabulary', () => {
  let windowInstance: Window;
  let host: HTMLDivElement;
  let root: Root;
  let globalDescriptors: Map<string, PropertyDescriptor | undefined>;
  const globalNames = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT'];

  beforeEach(() => {
    windowInstance = new Window();
    globalDescriptors = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    Object.assign(globalThis, {
      window: windowInstance,
      document: windowInstance.document,
      HTMLElement: windowInstance.HTMLElement,
      Element: windowInstance.Element,
      Node: windowInstance.Node,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    try {
      await act(async () => root.unmount());
    } finally {
      windowInstance.close();
      for (const [name, descriptor] of globalDescriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });

  const renderIcon = async (status: LaneStatus): Promise<DOMTokenList> => {
    await act(async () => root.render(<I18nProvider><LaneStatusIcon status={status} /></I18nProvider>));
    const icon = host.querySelector('svg');
    if (!icon) throw new Error('status icon is missing');
    return icon.classList;
  };

  test('paints a waiting question amber and a running lane green', async () => {
    const question = await renderIcon('question');
    expect(question.contains('text-status-warning')).toBe(true);
    expect(question.contains('text-status-info')).toBe(false);
    expect(question.contains('text-status-success')).toBe(false);

    const working = await renderIcon('working');
    expect(working.contains('text-status-success')).toBe(true);
    expect(working.contains('animate-spin')).toBe(true);
    expect(working.contains('text-status-warning')).toBe(false);
    expect(working.contains('text-status-info')).toBe(false);
  });

  test('leaves the permission stop sign red and the flat facts grey', async () => {
    const permission = await renderIcon('permission');
    expect(permission.contains('text-destructive')).toBe(true);

    // A turn that ended without an answer waits on a human too, so it stays
    // amber next to the question.
    const noReply = await renderIcon('noReply');
    expect(noReply.contains('text-[var(--status-warning)]')).toBe(true);

    for (const flat of ['stopped', 'notStarted', 'finished'] as const) {
      const classes = await renderIcon(flat);
      expect(classes.contains('text-muted-foreground')).toBe(true);
    }

    const failed = await renderIcon('failed');
    expect(failed.contains('text-[var(--status-error)]')).toBe(true);
  });
});
