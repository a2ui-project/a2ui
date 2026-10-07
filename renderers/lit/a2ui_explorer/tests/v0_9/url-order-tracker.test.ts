/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  loadExample,
  getSurface,
  getDeepTextContent,
  querySelectorAllDeep,
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

async function waitForText(surface: HTMLElement, expected: string, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (getDeepTextContent(surface).includes(expected)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for "${expected}" in "${getDeepTextContent(surface)}"`);
}

describe('Example: URL Order Tracker', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  beforeEach(async () => {
    gallery = await loadExample('url-order-tracker.json');
    surface = getSurface(gallery);
    await waitForText(surface, 'Status: 1 processing, 2 shipped');
  });

  afterEach(() => {
    gallery?.remove();
  });

  it('renders the sandboxed URL order tracker and writes the initial status summary', () => {
    const textContent = getDeepTextContent(surface);
    expect(textContent).toContain('Order tracker');
    expect(textContent).toContain('Status: 1 processing, 2 shipped');
    expect(querySelectorAllDeep(surface, 'a2ui-web-app-frame-url iframe').length).toBe(1);
  });

  it('recomputes the status summary and logs order_delivered when an order status is updated', async () => {
    const surfaceEl = gallery.shadowRoot?.querySelector('a2ui-surface') as
      | (HTMLElement & {surface?: {dataModel: {set(path: string, value: unknown): void}}})
      | null;
    expect(surfaceEl?.surface).toBeTruthy();

    surfaceEl!.surface!.dataModel.set('/orders/0/status', 'delivered');

    await waitForText(surface, 'Status: 1 processing, 1 shipped, 1 delivered');
    expect(gallery.actionLog.some(a => a.name === 'order_delivered')).toBeTrue();
  });
});
