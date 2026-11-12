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
 * Installs jsdom globals before `lit` or `@a2ui/web_core` modules evaluate so
 * custom elements, `File`, and `FileReader` work under `node --test`.
 */

import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><body></body>', {pretendToBeVisual: true});
const w = dom.window as unknown as Record<string, unknown>;
const g = globalThis as unknown as Record<string, unknown>;

for (const name of [
  'window',
  'document',
  'Document',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLLabelElement',
  'HTMLButtonElement',
  'HTMLTemplateElement',
  'customElements',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'DOMException',
  'Blob',
  'File',
  'FileReader',
  'MutationObserver',
  'CSSStyleSheet',
  'ShadowRoot',
]) {
  if (w[name] !== undefined) {
    g[name] = name === 'window' ? dom.window : w[name];
  }
}

g['requestAnimationFrame'] = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16);
g['cancelAnimationFrame'] = (id: number) => clearTimeout(id);

/** Empties `document.body` between tests so custom elements do not leak state. */
export function resetTestDom(): void {
  dom.window.document.body.innerHTML = '';
}
