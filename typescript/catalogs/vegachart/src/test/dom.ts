/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Installs jsdom globals so Lit elements can be instantiated under
 * `node --test`. Import this module before any module that imports `lit`.
 */

import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><body></body>', {pretendToBeVisual: true});
const w = dom.window as unknown as Record<string, unknown>;
const g = globalThis as Record<string, unknown>;

for (const name of [
  'window',
  'document',
  'Document',
  'HTMLElement',
  'HTMLTemplateElement',
  'HTMLIFrameElement',
  'customElements',
  'Element',
  'Node',
  'Event',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'CSSStyleSheet',
  'ShadowRoot',
]) {
  g[name] = name === 'window' ? dom.window : w[name];
}

/** Records every observer so tests can simulate size changes. */
export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  private targets: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  unobserve() {}

  disconnect() {
    this.targets = [];
  }

  /** Invokes the callback as if every observed target now had this size. */
  trigger(width: number, height: number) {
    const entries = this.targets.map(
      target =>
        ({
          target,
          contentRect: {width, height, top: 0, left: 0, bottom: height, right: width, x: 0, y: 0},
        }) as unknown as ResizeObserverEntry,
    );
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

g['ResizeObserver'] = FakeResizeObserver;

/** Returns the most recently created observer. */
export function latestResizeObserver(): FakeResizeObserver | undefined {
  return FakeResizeObserver.instances.at(-1);
}

/** Overrides the measured size of `el` and whether it is attached to layout. */
export function mockRect(el: HTMLElement, width: number, height: number, attached = true) {
  el.getBoundingClientRect = () =>
    ({width, height, top: 0, left: 0, bottom: height, right: width, x: 0, y: 0}) as DOMRect;
  el.getClientRects = () => (attached ? [{} as DOMRect] : []) as unknown as DOMRectList;
}

/** Waits for a few macrotasks so pending animation frames and embeds settle. */
export async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 20));
  }
}
