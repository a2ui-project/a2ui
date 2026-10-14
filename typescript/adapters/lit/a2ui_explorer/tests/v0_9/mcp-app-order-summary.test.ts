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
  let gallery: LocalGallery;
  let surface: HTMLElement;

  beforeEach(async () => {
    gallery = await loadExample('mcp-app-order-summary.json');
    surface = getSurface(gallery);
    await waitForCondition(
      () =>
        gallery.actionLog.some(a => a.name === 'get_order') &&
        getDeepTextContent(surface).includes('Total due: $90.00'),
    );
  });

  afterEach(() => {
    gallery?.remove();
  });

  it('renders the sandboxed MCP app and dispatches the get_order tool call as an action', () => {
    const textContent = getDeepTextContent(surface);
    expect(textContent).toContain('Discount code');
    expect(textContent).toContain('Total due: $90.00');
    expect(querySelectorAllDeep(surface, 'a2ui-mcp-app iframe').length).toBe(1);
    const getOrderAction = gallery.actionLog.find(a => a.name === 'get_order');
    expect(getOrderAction?.context).toEqual({orderId: 'A-1042'});
  });

  it('applies the discount code typed in the text field', async () => {
    const discountInput = (querySelectorAllDeep(surface, 'input') as HTMLInputElement[]).find(
      el => el.placeholder === 'SAVE10',
    );
    expect(discountInput).toBeTruthy();
    discountInput!.value = 'SAVE10';
    discountInput!.dispatchEvent(new Event('input', {bubbles: true, composed: true}));

    await waitForCondition(() => getDeepTextContent(surface).includes('Total due: $81.00'));
  });

  it('attaches explorer host resize handles to each McpApp and resizes on drag', async () => {
    await waitForCondition(
      () => querySelectorAllDeep(surface, '.explorer-mcp-resize-corner').length === 1,
    );
    const [mcpApp] = querySelectorAllDeep(surface, 'a2ui-mcp-app') as HTMLElement[];
    const corner = mcpApp.querySelector('.explorer-mcp-resize-corner') as HTMLElement;
    const badge = mcpApp.querySelector('.explorer-mcp-resize-badge') as HTMLElement;
    expect(corner).toBeTruthy();
    expect(badge).toBeTruthy();

    mcpApp.style.width = '400px';
    mcpApp.style.height = '220px';

    corner.dispatchEvent(
      new PointerEvent('pointerdown', {clientX: 100, clientY: 100, pointerId: 1, bubbles: true}),
    );
    corner.dispatchEvent(
      new PointerEvent('pointermove', {clientX: 220, clientY: 200, pointerId: 1, bubbles: true}),
    );
    corner.dispatchEvent(
      new PointerEvent('pointerup', {clientX: 220, clientY: 200, pointerId: 1, bubbles: true}),
    );

    expect(mcpApp.style.width).toBe('520px');
    expect(mcpApp.style.height).toBe('320px');
    expect(mcpApp.style.left).toBe('50%');
    expect(mcpApp.style.transform).toBe('translateX(-50%)');
    expect(badge.textContent).toContain('520 × 320 px');

    corner.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
    expect(mcpApp.style.width).toBe('');
    expect(mcpApp.style.left).toBe('');
    expect(mcpApp.style.transform).toBe('');
    expect(badge.textContent).toBe('');
  });

  it('registers all 3 MCP App examples in the Explorer', () => {
    const filenames = gallery.demoItems.map(item => item.filename);
    expect(filenames).toContain('mcp-app-order-summary.json');
    expect(filenames).toContain('mcp-app-sheet-music.json');
    expect(filenames).toContain('mcp-app-3d-geometry.json');
  });
});
