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

import type {A2uiClientAction} from '@a2ui/web_core/v0_9';
import {loadExample, cleanup, getSurface} from '../utils/test-utils';

async function waitForCondition(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
}

describe('Example: MCP App Order Summary', () => {
  let container: HTMLDivElement;
  let surface: HTMLElement;
  let actions: A2uiClientAction[];

  beforeEach(async () => {
    actions = [];
    container = await loadExample('mcp-app-order-summary.json', action => actions.push(action));
    surface = getSurface(container);
    await waitForCondition(
      () =>
        actions.some(a => a.name === 'get_order') &&
        (surface.textContent ?? '').includes('Total due: $90.00') &&
        (container.querySelector('[aria-label="Inspector Panel"]')?.textContent ?? '').includes(
          '"name": "get_order"',
        ),
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it('renders the sandboxed MCP app and dispatches the get_order tool call as an action', () => {
    expect(surface.textContent).toContain('Discount code');
    expect(surface.textContent).toContain('Total due: $90.00');
    expect(surface.querySelector('a2ui-mcp-app iframe')).toBeTruthy();

    const getOrderAction = actions.find(a => a.name === 'get_order');
    expect(getOrderAction?.context).toEqual({orderId: 'A-1042'});
  });

  it('logs the get_order tool call in the inspector Action Logs', () => {
    const inspector = container.querySelector('[aria-label="Inspector Panel"]');
    expect(inspector?.textContent).toContain('"name": "get_order"');
    expect(inspector?.textContent).toContain('"orderId": "A-1042"');
  });

  it('lists all 3 MCP App examples in the navigation sidebar', () => {
    const navText =
      container.querySelector('[aria-label="Examples Navigation"]')?.textContent ?? '';
    expect(navText).toContain('Mcp App Order Summary');
    expect(navText).toContain('Mcp App Sheet Music');
    expect(navText).toContain('Mcp App 3d Geometry');
  });
});
