/*
 * Copyright 2026 Google LLC
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

import {setupTestDom, teardownTestDom, asyncUpdate} from './dom-setup.js';
import assert from 'node:assert';
import {describe, it, beforeEach, afterEach, after, before} from 'node:test';
import type {html as HtmlTag} from 'lit';
import type {A2uiSurface} from '../surface/a2ui-surface.js';
import {MessageProcessor} from '@a2ui/web_core/v0_9';

/**
 * Verifies the Lit renderer's fallback behaviour (LIT-01/02/03, FB-02):
 * - the root pending state renders no visible default text but keeps its slot;
 * - a nested pending child renders nothing (and does not throw), then re-renders
 *   on arrival;
 * - consumer `loading` / `unknownComponent` fallbacks reach nested children via
 *   `@lit/context`;
 * - unknown component types dispatch COMPONENT_NOT_FOUND once per type, and the
 *   root context-creation failure dispatches the error state.
 */
describe('fallbacks', () => {
  let basicCatalog: any;
  // Imported dynamically AFTER jsdom globals exist (see dom-setup.ts): importing
  // `lit` before setupTestDom evaluates LitElement in an empty Node context and
  // breaks custom-element registration.
  let html: typeof HtmlTag;

  before(async () => {
    setupTestDom();
    html = (await import('lit')).html;
    await import('../surface/a2ui-surface.js');
    basicCatalog = (await import('../catalogs/basic/index.js')).basicCatalog;
  });
  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surfaceModel: any;
  const mounted: Array<HTMLElement> = [];

  beforeEach(() => {
    processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {surfaceId: 'test-surface', catalogId: basicCatalog.id},
      },
    ]);
    surfaceModel = processor.model.getSurface('test-surface')!;
  });

  afterEach(() => {
    for (const el of mounted.splice(0)) el.remove();
  });

  /** Applies an `updateComponents` message to the shared test surface. */
  function updateComponents(components: unknown[]) {
    processor.processMessages([
      {version: 'v0.9', updateComponents: {surfaceId: 'test-surface', components}},
    ]);
  }

  /** Creates a second, independent surface model with the given components. */
  function makeSurface(surfaceId: string, components: unknown[]) {
    processor.processMessages([
      {version: 'v0.9', createSurface: {surfaceId, catalogId: basicCatalog.id}},
      {version: 'v0.9', updateComponents: {surfaceId, components}},
    ]);
    return processor.model.getSurface(surfaceId)!;
  }

  /**
   * Wraps a components model's `onCreated.subscribe` to count live/total
   * subscriptions, so leak/dedup/cleanup invariants can be asserted directly.
   */
  function spyOnCreated(componentsModel: any) {
    const emitter = componentsModel.onCreated;
    const orig = emitter.subscribe;
    const state = {active: 0, total: 0};
    emitter.subscribe = (cb: any) => {
      state.total++;
      state.active++;
      const sub = orig.call(emitter, cb);
      const origUnsub = sub.unsubscribe.bind(sub);
      return {
        unsubscribe: () => {
          state.active--;
          origUnsub();
        },
      };
    };
    return {state, restore: () => (emitter.subscribe = orig)};
  }

  /** Creates, mounts, and awaits an `<a2ui-surface>` after `configure` runs. */
  async function mountSurface(configure: (el: A2uiSurface) => void): Promise<A2uiSurface> {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    mounted.push(el as unknown as HTMLElement);
    document.body.appendChild(el);
    await asyncUpdate(el, e => configure(e));
    await el.updateComplete;
    return el;
  }

  /** Resolves after the current microtask queue drains (the deferred dispatch). */
  const flushMicrotasks = () => new Promise<void>(r => queueMicrotask(() => r()));

  /** Awaits a nested catalog element's own update cycle before reading its DOM. */
  async function childShadow(el: A2uiSurface, selector: string): Promise<string | undefined> {
    const child = el.shadowRoot?.querySelector(selector) as any;
    if (child?.updateComplete) await child.updateComplete;
    return child?.shadowRoot?.innerHTML;
  }

  // --- LIT-01: silent root default, preserved slot -------------------------

  it('LIT-01: root pending renders no visible default text', async () => {
    const el = await mountSurface(e => {
      e.surface = surfaceModel;
    });

    const shadow = el.shadowRoot?.innerHTML ?? '';
    assert.ok(!shadow.includes('Loading surface'), 'No default loading text: ' + shadow);
    assert.ok(shadow.includes('<slot name="loading">'), 'Slot must be preserved: ' + shadow);
  });

  it('LIT-01: a consumer-projected slot="loading" still renders while pending', async () => {
    const el = await mountSurface(e => {
      e.innerHTML = '<div slot="loading">custom-loading</div>';
      e.surface = surfaceModel;
    });

    const slot = el.shadowRoot?.querySelector('slot[name="loading"]') as any;
    assert.ok(slot, 'Named slot element should exist in the shadow root');
    const projected = el.querySelector('[slot="loading"]');
    assert.ok(projected, 'Consumer slot="loading" content should remain projectable');
    assert.strictEqual(projected?.textContent, 'custom-loading');
    // The slot resolves the projected light-DOM child (jsdom supports assignedNodes).
    const assigned = slot.assignedNodes?.({flatten: true}) ?? [];
    assert.ok(
      assigned.includes(projected),
      'Projected content should be assigned to the loading slot',
    );
  });

  // --- LIT-02: nested pending child, no throw, re-render on arrival ---------

  it('LIT-02: a nested pending child renders nothing without throwing', async () => {
    updateComponents([{id: 'root', component: 'Column', children: ['child1']}]);

    const el = await mountSurface(e => {
      e.surface = surfaceModel;
    });

    const columnHtml = await childShadow(el, 'a2ui-basic-column');
    assert.ok(columnHtml !== undefined, 'Column should render (no throw)');
    assert.ok(!columnHtml?.includes('a2ui-basic-text'), 'No child should be present yet');
  });

  it('LIT-02: re-renders the nested child once it arrives via updateComponents', async () => {
    updateComponents([{id: 'root', component: 'Column', children: ['child1']}]);

    const el = await mountSurface(e => {
      e.surface = surfaceModel;
    });

    // The child streams in later; the targeted onCreated subscription must fire
    // and re-render the column (an A2uiLitElement) to resolve the child.
    updateComponents([{id: 'child1', component: 'Text', text: 'Arrived'}]);
    await el.updateComplete;

    const columnEl = el.shadowRoot?.querySelector('a2ui-basic-column') as any;
    await columnEl?.updateComplete;
    const textEl = columnEl?.shadowRoot?.querySelector('a2ui-basic-text') as any;
    await textEl?.updateComplete;
    const textHtml = textEl?.shadowRoot?.innerHTML;
    assert.ok(
      textHtml?.includes('Arrived'),
      'Nested child should render after arrival (proves onCreated re-subscribe): ' + textHtml,
    );
  });

  // --- LIT-03: consumer fallbacks reach nested children via context --------

  it('LIT-03: a nested pending child renders the consumer loading fallback via context', async () => {
    updateComponents([{id: 'root', component: 'Column', children: ['child1']}]);

    const el = await mountSurface(e => {
      e.surface = surfaceModel;
      e.fallbacks = {loading: html`<div class="nested-spin">spinning</div>`};
    });

    const columnHtml = await childShadow(el, 'a2ui-basic-column');
    assert.ok(
      columnHtml?.includes('nested-spin'),
      'Nested loading fallback should render inside the column via @lit/context. Got: ' +
        columnHtml,
    );
  });

  it('LIT-03: the loading fallback receives the fallback info payload', async () => {
    updateComponents([{id: 'root', component: 'Column', children: ['child1']}]);

    const el = await mountSurface(e => {
      e.surface = surfaceModel;
      e.fallbacks = {
        loading: info =>
          html`<span class="info">${info.componentId}:${info.parentComponentType}</span>`,
      };
    });

    // Lit interpolates each expression as a separate text node (comment markers
    // sit between them), so assert the two values are present rather than the
    // concatenated string.
    const columnHtml = await childShadow(el, 'a2ui-basic-column');
    assert.ok(
      columnHtml?.includes('child1'),
      'componentId should flow through. Got: ' + columnHtml,
    );
    assert.ok(
      columnHtml?.includes('Column'),
      'parentComponentType should flow through. Got: ' + columnHtml,
    );
  });

  it('LIT-03: an unknown component type renders the consumer unknownComponent fallback', async () => {
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      updateComponents([{id: 'root', component: 'Nope', text: 'x'}]);

      const el = await mountSurface(e => {
        e.surface = surfaceModel;
        e.fallbacks = {
          unknownComponent: info => html`<div class="unknown-fb">${info.componentType}</div>`,
        };
      });
      await flushMicrotasks();

      const shadow = el.shadowRoot?.innerHTML ?? '';
      assert.ok(
        shadow.includes('unknown-fb'),
        'unknownComponent fallback should render: ' + shadow,
      );
      assert.ok(shadow.includes('Nope'), 'componentType should flow to the fallback: ' + shadow);
    } finally {
      console.warn = origWarn;
    }
  });

  // --- FB-02: structured error dispatch ------------------------------------

  it('FB-02: dispatches COMPONENT_NOT_FOUND once per unknown type', async () => {
    const origWarn = console.warn;
    console.warn = () => {};
    const calls: any[] = [];
    surfaceModel.dispatchError = (e: any) => {
      calls.push(e);
      return Promise.resolve();
    };
    try {
      updateComponents([{id: 'root', component: 'Nope', text: 'x'}]);

      const el = await mountSurface(e => {
        e.surface = surfaceModel;
      });
      await flushMicrotasks();

      assert.strictEqual(calls.length, 1, 'Exactly one dispatch for the unknown type');
      assert.strictEqual(calls[0].code, 'COMPONENT_NOT_FOUND');
      assert.strictEqual(calls[0].componentId, 'root');
      assert.strictEqual(calls[0].componentType, 'Nope');
      assert.ok(String(calls[0].message).includes('Nope'));

      // A second render of the same unknown type must not re-dispatch.
      await asyncUpdate(el, e => {
        e.fallbacks = {loading: html`<span></span>`};
      });
      await el.updateComplete;
      await flushMicrotasks();

      assert.strictEqual(calls.length, 1, 'The warn-once guard must hold across re-renders');
    } finally {
      console.warn = origWarn;
    }
  });

  it('FB-02: the root context-creation failure dispatches the error state', async () => {
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = () => {};
    console.error = () => {};
    const calls: any[] = [];
    surfaceModel.dispatchError = (e: any) => {
      calls.push(e);
      return Promise.resolve();
    };
    try {
      updateComponents([{id: 'root', component: 'Text', text: 'Hello'}]);

      const el = await mountSurface(e => {
        e.surface = surfaceModel;
      });

      // Remove root while _hasRoot is still true so the render-time
      // `new ComponentContext(surface, 'root', ...)` throws (not-found) and hits
      // the root catch.
      surfaceModel.componentsModel.removeComponent('root');
      el.requestUpdate();
      await el.updateComplete;
      await flushMicrotasks();

      const shadow = el.shadowRoot?.innerHTML ?? '';
      assert.ok(
        shadow.includes('Error rendering surface'),
        'Visible error text retained: ' + shadow,
      );
      const errorCall = calls.find(c => c.code === 'SURFACE_RENDER_ERROR');
      assert.ok(errorCall, 'An error-state dispatch should occur: ' + JSON.stringify(calls));
      assert.ok('reason' in errorCall, 'The error dispatch should carry the thrown reason');
    } finally {
      console.warn = origWarn;
      console.error = origError;
    }
  });

  // --- WR-04: subscription lifecycle / no-leak invariants -------------------

  it('WR-04a: disconnectedCallback unsubscribes the pending-child subscription', async () => {
    updateComponents([{id: 'root', component: 'Column', children: ['child1']}]);
    const spy = spyOnCreated(surfaceModel.componentsModel);
    try {
      const el = await mountSurface(e => {
        e.surface = surfaceModel;
      });
      const columnEl = el.shadowRoot?.querySelector('a2ui-basic-column') as any;
      await columnEl?.updateComplete;
      assert.strictEqual(spy.state.active, 1, 'One live subscription for the pending child');

      el.remove();
      assert.strictEqual(
        spy.state.active,
        0,
        'disconnectedCallback must unsubscribe the pending-child subscription',
      );

      // A late arrival must not resurrect a disconnected subscription.
      updateComponents([{id: 'child1', component: 'Text', text: 'Late'}]);
      await flushMicrotasks();
      assert.strictEqual(spy.state.active, 0, 'No subscription should survive disconnect');
    } finally {
      spy.restore();
    }
  });

  it('WR-04b: a pending child yields exactly one subscription across repeated renders', async () => {
    updateComponents([{id: 'root', component: 'Column', children: ['child1']}]);
    const spy = spyOnCreated(surfaceModel.componentsModel);
    try {
      const el = await mountSurface(e => {
        e.surface = surfaceModel;
      });
      const columnEl = el.shadowRoot?.querySelector('a2ui-basic-column') as any;
      await columnEl?.updateComplete;

      // Re-render the Column repeatedly while child1 is still pending; the Map
      // guard must keep this at exactly one subscription per child id.
      for (let i = 0; i < 3; i++) {
        columnEl.requestUpdate();
        await columnEl.updateComplete;
      }

      assert.strictEqual(
        spy.state.total,
        1,
        'Exactly one onCreated subscription per pending child id (no double-subscribe)',
      );
    } finally {
      spy.restore();
    }
  });

  it('WR-04c: rebinding to a new surface does not leak the old surface subscription', async () => {
    updateComponents([{id: 'root', component: 'Column', children: ['child1']}]);
    const surfaceB = makeSurface('surface-b', [
      {id: 'root', component: 'Column', children: ['child1']},
    ]);
    const spyA = spyOnCreated(surfaceModel.componentsModel);
    const spyB = spyOnCreated(surfaceB.componentsModel);
    try {
      const el = await mountSurface(e => {
        e.surface = surfaceModel;
      });
      let columnEl = el.shadowRoot?.querySelector('a2ui-basic-column') as any;
      await columnEl?.updateComplete;
      assert.strictEqual(
        spyA.state.active,
        1,
        'Column subscribes to surface A while child pending',
      );

      // Rebind the reused element to surface B. willUpdate must clear the stale
      // #childSubs before resubscribing, or surface A retains a live subscription.
      await asyncUpdate(el, e => {
        e.surface = surfaceB;
      });
      await el.updateComplete;
      columnEl = el.shadowRoot?.querySelector('a2ui-basic-column') as any;
      await columnEl?.updateComplete;

      assert.strictEqual(
        spyA.state.active,
        0,
        'No stale subscription must survive on the old surface (WR-01)',
      );
      assert.strictEqual(spyB.state.active, 1, 'The child subscription moves to the new surface');
    } finally {
      spyA.restore();
      spyB.restore();
    }
  });

  it('WR-04d: a second surface root failure re-arms the error dispatch', async () => {
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = () => {};
    console.error = () => {};
    const calls: any[] = [];
    surfaceModel.dispatchError = (e: any) => {
      calls.push({s: 'A', ...e});
      return Promise.resolve();
    };
    const surfaceB = makeSurface('surface-b', [{id: 'root', component: 'Text', text: 'B'}]);
    surfaceB.dispatchError = (e: any) => {
      calls.push({s: 'B', ...e});
      return Promise.resolve();
    };
    try {
      updateComponents([{id: 'root', component: 'Text', text: 'Hello'}]);
      const el = await mountSurface(e => {
        e.surface = surfaceModel;
      });

      // Fail surface A's root render so the error dispatch fires for A.
      surfaceModel.componentsModel.removeComponent('root');
      el.requestUpdate();
      await el.updateComplete;
      await flushMicrotasks();
      assert.ok(
        calls.some(c => c.s === 'A' && c.code === 'SURFACE_RENDER_ERROR'),
        'Surface A root failure should dispatch: ' + JSON.stringify(calls),
      );

      // Rebind to surface B (root present, renders fine).
      await asyncUpdate(el, e => {
        e.surface = surfaceB;
      });
      await el.updateComplete;

      // Fail surface B's root render. A per-element boolean guard would stay
      // latched from surface A and suppress this; a surface-keyed guard re-arms.
      surfaceB.componentsModel.removeComponent('root');
      el.requestUpdate();
      await el.updateComplete;
      await flushMicrotasks();

      assert.ok(
        calls.some(c => c.s === 'B' && c.code === 'SURFACE_RENDER_ERROR'),
        'A second surface root failure must re-arm and dispatch (WR-02): ' + JSON.stringify(calls),
      );
    } finally {
      console.warn = origWarn;
      console.error = origError;
    }
  });
});
