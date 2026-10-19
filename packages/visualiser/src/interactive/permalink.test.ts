/**
 * @file Tests for focused node permalinks (issue 505).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachPermalinkButton,
  buildNodePermalink,
} from './permalink.ts';
import { renderDiagramSvg } from '../render.ts';
import type { DiagramModel } from '../index.ts';

// ---------------------------------------------------------------------------
// DOM double for permalink button testing
// ---------------------------------------------------------------------------

class FakeClassList {
  private readonly tokens = new Set<string>();
  add(...names: string[]): void {
    for (const n of names) this.tokens.add(n);
  }
  remove(...names: string[]): void {
    for (const n of names) this.tokens.delete(n);
  }
  contains(name: string): boolean {
    return this.tokens.has(name);
  }
  toString(): string {
    return [...this.tokens].join(' ');
  }
}

class FakeElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  classList = new FakeClassList();
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  value = '';
  focused = false;
  selected = false;
  private ownText = '';
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  readonly ownerDocument: FakeDocument;

  constructor(tagName: string, doc: FakeDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
  }

  get textContent(): string {
    if (this.children.length === 0) return this.ownText;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(val: string) {
    this.ownText = val;
    this.children.length = 0;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  focus(): void {
    this.focused = true;
  }

  select(): void {
    this.selected = true;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: { type: string; [key: string]: unknown }): void {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const fn of set) fn(event);
    }
  }

  querySelector<T = FakeElement>(selector: string): T | null {
    for (const child of this.children) {
      if (selector === 'input.viz-permalink-fallback' && child.tagName === 'INPUT') {
        return child as unknown as T;
      }
    }
    return null;
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('buildNodePermalink: builds URL with focus query param and anchor fragment', () => {
  const url1 = buildNodePermalink('fn:claim', 'https://signet.local/p/test/contract/addr/diagram');
  assert.ok(url1.includes('focus=fn%3Aclaim') || url1.includes('focus=fn:claim'));
  assert.ok(url1.includes('#diagram-fn-claim'));

  const url2 = buildNodePermalink('fn:swap', '/p/test/contract/addr/diagram?existing=1');
  assert.ok(url2.includes('focus=fn%3Aswap') || url2.includes('focus=fn:swap'));
  assert.ok(url2.includes('existing=1'));
  assert.ok(url2.endsWith('#diagram-fn-swap'));
});

test('attachPermalinkButton: adds button and copies via clipboard when available', async () => {
  const doc = new FakeDocument();
  const card = doc.createElement('div');

  let writtenText = '';
  // Set up mock clipboard
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText: async (text: string) => {
          writtenText = text;
        },
      },
    },
    configurable: true,
  });

  let copiedUrl = '';
  const button = attachPermalinkButton(card as unknown as HTMLElement, 'fn:claim', {
    baseUrl: 'https://signet.local/test',
    onCopy: (url) => {
      copiedUrl = url;
    },
  });

  assert.equal(button.textContent, 'Copy link to this node');
  assert.equal(card.children.length, 1);

  await button.dispatchEvent({
    type: 'click',
    preventDefault() {},
    stopPropagation() {},
  } as unknown as Event);

  assert.ok(writtenText.includes('focus=fn%3Aclaim') || writtenText.includes('focus=fn:claim'));
  assert.ok(writtenText.includes('#diagram-fn-claim'));
  assert.equal(copiedUrl, writtenText);
  assert.equal(button.textContent, 'Copied!');
});

test('attachPermalinkButton: falls back to text selection when clipboard is unavailable', async () => {
  const doc = new FakeDocument();
  const card = doc.createElement('div');

  // Remove clipboard
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    configurable: true,
  });

  let fallbackUrl = '';
  const button = attachPermalinkButton(card as unknown as HTMLElement, 'fn:claim', {
    baseUrl: 'https://signet.local/test',
    onFallback: (url) => {
      fallbackUrl = url;
    },
  });

  await button.dispatchEvent({
    type: 'click',
    preventDefault() {},
    stopPropagation() {},
  } as unknown as Event);

  const fallbackInput = card.querySelector<FakeElement>('input.viz-permalink-fallback');
  assert.ok(fallbackInput, 'fallback input should be created');
  assert.equal(fallbackInput.focused, true);
  assert.equal(fallbackInput.selected, true);
  assert.ok(fallbackUrl.includes('#diagram-fn-claim'));
});

test('renderDiagramSvg: focus highlights node, 1-hop neighbours, and dims the rest', () => {
  const model: DiagramModel = {
    nodes: [
      { id: 'fn:claim', label: 'claim' },
      { id: 'type:Address', label: 'Address' },
      { id: 'fn:other', label: 'other' },
      { id: 'type:Unrelated', label: 'Unrelated' },
    ],
    edges: [
      { from: 'fn:claim', to: 'type:Address' },
      { from: 'fn:other', to: 'type:Unrelated' },
    ],
  };

  const svg = renderDiagramSvg(model, {
    idPrefix: 'test-',
    hrefForNode: () => '/docs',
    title: 'Test',
    focus: 'fn:claim',
  });

  // Focused node
  assert.ok(svg.includes('id="diagram-fn-claim"'));
  assert.ok(svg.includes('data-node-id="fn:claim" class="viz-focused" autofocus=""'));

  // 1-hop neighbour
  assert.ok(svg.includes('id="diagram-type-Address"'));
  assert.ok(svg.includes('data-node-id="type:Address" class="viz-neighbour"'));

  // Dimmed nodes
  assert.ok(svg.includes('data-node-id="fn:other" class="viz-dimmed"'));
  assert.ok(svg.includes('data-node-id="type:Unrelated" class="viz-dimmed"'));

  // Incident edge highlighted
  assert.ok(svg.includes('class="diagram-edge viz-edge--incident"'));
  // Unrelated edge dimmed
  assert.ok(svg.includes('class="diagram-edge viz-dimmed"'));
});

test('renderDiagramSvg: invalid focus renders default view with status 200 equivalent', () => {
  const model: DiagramModel = {
    nodes: [
      { id: 'fn:claim', label: 'claim' },
      { id: 'type:Address', label: 'Address' },
    ],
    edges: [{ from: 'fn:claim', to: 'type:Address' }],
  };

  const svg = renderDiagramSvg(model, {
    idPrefix: 'test-',
    hrefForNode: () => '/docs',
    title: 'Test',
    focus: 'fn:nonexistent',
  });

  assert.ok(svg.includes('<svg'));
  assert.equal(svg.includes('viz-focused'), false);
  assert.equal(svg.includes('viz-neighbour'), false);
  assert.equal(svg.includes('viz-dimmed'), false);
});
