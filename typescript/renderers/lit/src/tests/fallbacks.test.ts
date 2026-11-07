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

import {setupTestDom, teardownTestDom} from './dom-setup.js';
import assert from 'node:assert';
import {describe, it, before, after, afterEach} from 'node:test';
import {html} from 'lit';
import {
  Catalog,
  ComponentModel,
  SurfaceModel,
  type A2uiErrorInfo,
  type A2uiPendingInfo,
} from '@a2ui/web_core';
import {basicCatalog as v1BasicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import type {A2uiSurface} from '../index.js';
import type {LitComponentApi} from '../types.js';

/** Waits until no element below `root` has a pending Lit update. */
async function settle(root: Element) {
  for (let i = 0; i < 10; i++) {
    const pending = [root, ...root.querySelectorAll('*')]
      .map(e => (e as {updateComplete?: Promise<boolean>}).updateComplete)
      .filter(p => p !== undefined);
    if ((await Promise.all(pending)).every(Boolean)) return;
  }
}

describe('A2uiSurface fallbacks', () => {
  const catalogs: Record<string, Catalog<LitComponentApi>> = {};
  const mounted: HTMLElement[] = [];

  before(async () => {
    setupTestDom();
    await import('../surface/a2ui-surface.js');
    catalogs['v0.9'] = (await import('../v0_9/catalogs/basic/index.js')).basicCatalog;
    catalogs['1.0'] = v1BasicCatalog as unknown as Catalog<LitComponentApi>;
  });
  afterEach(() => {
    while (mounted.length) mounted.pop()!.remove();
  });
  after(teardownTestDom);

  function add(surface: SurfaceModel<LitComponentApi>, id: string, type: string, props = {}) {
    surface.componentsModel.addComponent(
      new ComponentModel(id, type, props, surface.defaultCatalog!),
    );
  }

  async function mount(
    surface: SurfaceModel<LitComponentApi>,
    fallbacks?: A2uiSurface['fallbacks'],
  ) {
    const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
    el.fallbacks = fallbacks;
    el.surface = surface;
    document.body.appendChild(el);
    mounted.push(el);
    await settle(el);
    return el;
  }

  const fallbacks = {
    pending: (info: A2uiPendingInfo) =>
      info.parentComponentType === 'List'
        ? html`<div class="skeleton">${info.componentId}</div>`
        : html`<div class="spinner">${info.componentId}</div>`,
    error: (info: A2uiErrorInfo) =>
      html`<div class="error">${info.error.type} ${info.error.componentType ?? ''}</div>`,
  };

  it('renders the pending fallback for the root before it arrives, then the root', async () => {
    const surface = new SurfaceModel<LitComponentApi>(
      's',
      catalogs['v0.9'],
      undefined,
      undefined,
      undefined,
      undefined,
      'main',
    );
    const infos: A2uiPendingInfo[] = [];
    const el = await mount(surface, {
      pending: info => {
        infos.push(info);
        return html`<div class="spinner"></div>`;
      },
    });
    assert.ok(el.querySelector('.spinner'));
    assert.deepStrictEqual(infos[0], {componentId: 'main'});

    add(surface, 'main', 'Text', {text: 'Hello'});
    await settle(el);
    assert.strictEqual(el.querySelector('.spinner'), null);
    assert.strictEqual(el.querySelector('a2ui-basic-text')?.textContent?.trim(), 'Hello');
  });

  it('renders the error fallback for a root with an unknown type', async () => {
    const surface = new SurfaceModel<LitComponentApi>('s', catalogs['v0.9']);
    add(surface, 'root', 'StarRating');
    const el = await mount(surface, fallbacks);
    assert.strictEqual(el.querySelector('.error')?.textContent, 'unknown-type StarRating');
  });

  for (const version of ['v0.9', '1.0']) {
    it(`gives a pending List child the fallback for its parent type, replaced on arrival (${version})`, async () => {
      const surface = new SurfaceModel<LitComponentApi>('s', catalogs[version]);
      add(surface, 'root', 'Card', {child: 'list'});
      add(surface, 'list', 'List', {children: ['a', 'late']});
      add(surface, 'a', 'Text', {text: 'A'});
      const el = await mount(surface, fallbacks);

      const items = () => [...el.querySelectorAll('.a2ui-list-item-none')];
      assert.strictEqual(items().length, 2);
      assert.strictEqual(items()[1].querySelector('.skeleton')?.textContent, 'late');

      add(surface, 'late', 'Text', {text: 'Late'});
      await settle(el);
      assert.strictEqual(items().length, 2);
      assert.strictEqual(el.querySelector('.skeleton'), null);
      assert.strictEqual(items()[1].textContent?.trim(), 'Late');
    });
  }

  it('renders nothing, with no List item, when a builder returns null or throws', async () => {
    const surface = new SurfaceModel<LitComponentApi>('s', catalogs['v0.9']);
    add(surface, 'root', 'List', {children: ['a', 'late', 'stars']});
    add(surface, 'a', 'Text', {text: 'A'});
    add(surface, 'stars', 'StarRating');
    const originalError = console.error;
    let logged = 0;
    console.error = () => void logged++;
    try {
      const el = await mount(surface, {
        pending: () => null,
        error: () => {
          throw new Error('boom');
        },
      });
      assert.strictEqual(el.querySelectorAll('.a2ui-list-item-none').length, 1);
    } finally {
      console.error = originalError;
    }
    assert.ok(logged >= 1);
  });

  it('renders nothing for unresolved nodes without fallbacks', async () => {
    const surface = new SurfaceModel<LitComponentApi>('s', catalogs['v0.9']);
    const el = await mount(surface);
    assert.strictEqual(el.children.length, 0);
    add(surface, 'root', 'List', {children: ['a', 'late']});
    add(surface, 'a', 'Text', {text: 'A'});
    await settle(el);
    assert.strictEqual(el.querySelectorAll('.a2ui-list-item-none').length, 1);
  });
});
