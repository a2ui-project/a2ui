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

/**
 * The 3D geometry example: a canvas renderer inside the sandboxed `McpApp`, driven through its
 * `data.paths` bindings. The iframe is opaque-origin, so the test types in the sibling preset
 * `TextField` and reads what the app writes back to the sibling `Text` components.
 */
describe('Example: MCP App 3D geometry', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  beforeEach(async () => {
    gallery = await loadExample('mcp-app-3d-geometry.json');
    surface = getSurface(gallery);
    // The app has booted once it has published its own model context (ui/update-model-context).
    await waitForCondition(() =>
      getDeepTextContent(surface).includes('Model context: torusKnot (yaw'),
    );
  });

  afterEach(() => {
    gallery?.remove();
  });

  it('renders the sandboxed MCP app and shows its live telemetry and model context', () => {
    const textContent = getDeepTextContent(surface);
    expect(querySelectorAllDeep(surface, 'a2ui-mcp-app iframe').length).toBe(1);
    expect(textContent).toContain('3D Geometry Preset');
    expect(textContent).toContain('Captured 3D camera telemetry: torusKnot (yaw=');
    expect(textContent).toContain('Model context: torusKnot (yaw');
  });

  it('switches the geometry from the sibling text field through the data.paths binding', async () => {
    const presetInput = (querySelectorAllDeep(surface, 'input') as HTMLInputElement[]).find(
      el => el.placeholder === 'torusKnot',
    );
    expect(presetInput).toBeTruthy();
    presetInput!.value = 'crystal';
    presetInput!.dispatchEvent(new Event('input', {bubbles: true, composed: true}));

    // data-model-update reaches the app, which rebuilds the mesh and writes telemetry
    // (data-model-change) and model context (update-model-context) back for the new preset.
    await waitForCondition(
      () =>
        getDeepTextContent(surface).includes('Captured 3D camera telemetry: crystal (yaw=') &&
        getDeepTextContent(surface).includes('Model context: crystal (yaw'),
    );
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

  it('registers the MCP App example in the Explorer', () => {
    const filenames = gallery.demoItems.map(item => item.filename);
    expect(filenames).toContain('mcp-app-3d-geometry.json');
    expect(filenames.filter(name => name.startsWith('mcp-app-')).length).toBe(1);
  });
});
