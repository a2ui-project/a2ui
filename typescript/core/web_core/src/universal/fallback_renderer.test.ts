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

import * as assert from 'node:assert';
import {describe, it, after} from 'node:test';
import {setupTestDom, teardownTestDom} from '../test/dom-setup.js';
import {html, nothing, render} from 'lit';
import {rootPendingRequest} from '../resolution/fallbacks.js';
import {fallbackHost, registerFallbackRenderer, renderFallback} from './fallback_renderer.js';

setupTestDom();

after(teardownTestDom);

describe('fallback renderer registry', () => {
  const request = rootPendingRequest('root');

  it('renders null for a surface without a renderer', () => {
    assert.strictEqual(renderFallback({}, request), null);
  });

  it('passes the request to the surface renderer and returns its view', () => {
    const surface = {};
    const seen: unknown[] = [];
    const unregister = registerFallbackRenderer(surface, r => {
      seen.push(r);
      return 'view';
    });
    assert.strictEqual(renderFallback(surface, request), 'view');
    assert.deepStrictEqual(seen, [request]);
    assert.strictEqual(renderFallback({}, request), null, 'other surfaces are unaffected');
    unregister();
    assert.strictEqual(renderFallback(surface, request), null);
  });

  it('treats undefined and nothing as nothing', () => {
    const surface = {};
    registerFallbackRenderer(surface, () => undefined);
    assert.strictEqual(renderFallback(surface, request), null);
    registerFallbackRenderer(surface, () => nothing);
    assert.strictEqual(renderFallback(surface, request), null);
  });

  it('leaves a newer renderer registered when an older one unregisters', () => {
    const surface = {};
    const unregisterOld = registerFallbackRenderer(surface, () => 'old');
    registerFallbackRenderer(surface, () => 'new');
    unregisterOld();
    assert.strictEqual(renderFallback(surface, request), 'new');
  });

  it('logs a renderer that throws and renders nothing', () => {
    const surface = {};
    registerFallbackRenderer(surface, () => {
      throw new Error('boom');
    });
    const originalError = console.error;
    let logged = 0;
    console.error = () => void logged++;
    try {
      assert.strictEqual(renderFallback(surface, request), null);
    } finally {
      console.error = originalError;
    }
    assert.strictEqual(logged, 1);
  });
});

describe('fallbackHost', () => {
  it('keeps the element at its position across re-renders and reassigns its properties', () => {
    const container = document.createElement('div');
    const renderHost = (view: string) =>
      render(html`<div>${fallbackHost('a2ui-test-fallback-host', {view})}</div>`, container);
    renderHost('first');
    const first = container.querySelector('a2ui-test-fallback-host') as HTMLElement & {
      view?: string;
    };
    assert.strictEqual(first.view, 'first');
    assert.ok(first.hasAttribute('data-a2ui-fallback-host'));
    renderHost('second');
    const second = container.querySelector('a2ui-test-fallback-host');
    assert.strictEqual(second, first);
    assert.strictEqual(first.view, 'second');
  });
});
