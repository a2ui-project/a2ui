// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {describe, it, test, expect, beforeEach, afterEach} from 'vitest';
import {basicCatalog} from '@a2ui/lit/v0_9';
import type {A2UILayoutEditor} from '../app.js';

/**
 * Smoke test to ensure that the Vite dev server compilation pipeline correctly
 * transpiles Lit decorators. In Vite 8, a target compilation bug can cause
 * esbuild to serve uncompiled Stage-3 class decorators raw to the browser,
 * resulting in runtime SyntaxErrors.
 */
/**
 * Vite dev server compilation under JSDOM can be slow during cold runs,
 * particularly on CI environments. We use an increased timeout of 30 seconds
 * to prevent sporadic/flaky test timeouts.
 */
const VITE_COMPILE_TIMEOUT = 30000;

test(
  'a2ui-shell compiles and registers without syntax errors',
  async () => {
    const mod = await import('../app.js');
    expect(mod.A2UILayoutEditor).toBeDefined();
    expect(customElements.get('a2ui-shell')).toBeDefined();
  },
  VITE_COMPILE_TIMEOUT,
);

describe('a2ui-shell layout and inspector integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('renders <playground-inspector> when ?app=playground is active and toggles/resets cleanly', async () => {
    await import('../app.js');
    window.history.replaceState({}, '', '/?app=playground');
    const el = document.createElement('a2ui-shell') as A2UILayoutEditor;
    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.hasAttribute('inspector-layout')).toBe(true);
    const inspector = el.shadowRoot?.querySelector('playground-inspector') as
      | (HTMLElement & {trace: unknown})
      | null;
    expect(inspector).not.toBeNull();
    // Floating drawer toggle is hidden while the inspector panel is open
    expect(el.shadowRoot?.querySelector('.inspector-drawer-toggle')).toBeNull();

    // Click the "x" close button inside the inspector panel header
    const closeBtn = inspector!.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-testid="toggle-inspector"]',
    );
    expect(closeBtn).not.toBeNull();
    expect(closeBtn!.textContent).toContain('close');
    closeBtn!.click();
    await el.updateComplete;
    expect(el.hasAttribute('inspector-collapsed')).toBe(true);
    expect(el.shadowRoot?.querySelector('playground-inspector')).toBeNull();

    // Re-open via the floating Show Inspector button that appears when collapsed
    const toggleBtn = el.shadowRoot?.querySelector('.inspector-drawer-toggle') as HTMLButtonElement;
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn.textContent).toContain('Show Inspector');
    toggleBtn.click();
    await el.updateComplete;
    expect(el.hasAttribute('inspector-collapsed')).toBe(false);
    expect(el.shadowRoot?.querySelector('.inspector-drawer-toggle')).toBeNull();
    const reopened = el.shadowRoot?.querySelector('playground-inspector') as
      | (HTMLElement & {trace: unknown})
      | null;
    expect(reopened).not.toBeNull();

    // Dispatch reset-session event
    reopened!.dispatchEvent(new CustomEvent('reset-session', {bubbles: true, composed: true}));
    await el.updateComplete;
    expect(reopened!.trace).toBeNull();
  });

  it('omits <playground-inspector> for ?app=restaurant', async () => {
    await import('../app.js');
    window.history.replaceState({}, '', '/?app=restaurant');
    const el = document.createElement('a2ui-shell') as A2UILayoutEditor;
    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.hasAttribute('inspector-layout')).toBe(false);
    expect(el.shadowRoot?.querySelector('playground-inspector')).toBeNull();
  });

  it('prunes main surface when switching to turn-* render surfaces but preserves main on status cards', async () => {
    await import('../app.js');
    window.history.replaceState({}, '', '/?app=playground');
    const el = document.createElement('a2ui-shell') as A2UILayoutEditor;
    document.body.appendChild(el);
    await el.updateComplete;

    const internal = el as unknown as {
      _processor: {
        processMessages: (msgs: unknown[]) => void;
        getRendererCapabilities: (opts: {versions: string[]}) => {supportedCatalogIds: string[]};
        model: {surfacesMap: Map<string, unknown>};
      };
      _a2uiClient: {
        sendTurn: (msg: unknown) => Promise<{messages: unknown[]; trace: null; contextId: string}>;
      };
    };

    const catalogId = basicCatalog.id;
    const turns: unknown[][] = [
      [{version: 'v0.9', createSurface: {surfaceId: 'main', catalogId}}],
      [{version: 'v0.9', createSurface: {surfaceId: 'turn-1-status', catalogId}}],
      [{version: 'v0.9', createSurface: {surfaceId: 'turn-2-decision', catalogId}}],
    ];
    internal._a2uiClient.sendTurn = async () => ({
      messages: turns.shift() ?? [],
      trace: null,
      contextId: 'ctx-1',
    });

    const quickActionBtn = el.shadowRoot?.querySelector<HTMLButtonElement>('.quick-action-btn');
    expect(quickActionBtn).not.toBeNull();
    if (!quickActionBtn) {
      throw new Error('Expected .quick-action-btn in shadowRoot');
    }

    // Turn 1 creates 'main'
    quickActionBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(Array.from(internal._processor.model.surfacesMap.keys())).toEqual(['main']);

    // Turn 2 creates 'turn-1-status' (slash command card) and preserves 'main'
    quickActionBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(Array.from(internal._processor.model.surfacesMap.keys())).toEqual([
      'main',
      'turn-1-status',
    ]);

    // Turn 3 creates 'turn-2-decision' (compare/express render surface) and prunes both 'main' and 'turn-1-status' (M3)
    quickActionBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(Array.from(internal._processor.model.surfacesMap.keys())).toEqual(['turn-2-decision']);
  });
});
