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

import {loadExample, cleanup, getSurface} from '../utils/test-utils';

async function waitForText(surface: HTMLElement, expected: string, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if ((surface.textContent ?? '').includes(expected)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for "${expected}" in "${surface.textContent ?? ''}"`);
}

describe('Example: URL Order Tracker', () => {
  let container: HTMLDivElement;
  let surface: HTMLElement;

  beforeEach(async () => {
    container = await loadExample('url-order-tracker.json');
    surface = getSurface(container);
    await waitForText(surface, 'Status: 1 processing, 2 shipped');
  });

  afterEach(async () => {
    await cleanup();
  });

  it('renders the sandboxed URL order tracker and writes the initial status summary', () => {
    expect(surface.textContent).toContain('Order tracker');
    expect(surface.textContent).toContain('Status: 1 processing, 2 shipped');
    expect(surface.querySelector('a2ui-web-app-frame-url iframe')).toBeTruthy();
  });

  it('writes the computed status summary back to the surface data model in the inspector', async () => {
    const dataModelInput = container.querySelector(
      'textarea[aria-label="Data Model JSON"]',
    ) as HTMLTextAreaElement | null;
    expect(dataModelInput).toBeTruthy();
    const deadline = performance.now() + 5000;
    while (
      performance.now() < deadline &&
      !(dataModelInput?.value ?? '').includes('"summary": "1 processing, 2 shipped"')
    ) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(dataModelInput?.value).toContain('"summary": "1 processing, 2 shipped"');
  });
});
