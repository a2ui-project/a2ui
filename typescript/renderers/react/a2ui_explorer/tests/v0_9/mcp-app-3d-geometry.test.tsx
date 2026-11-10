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
  let container: HTMLDivElement;
  let surface: HTMLElement;

  beforeEach(async () => {
    container = await loadExample('mcp-app-3d-geometry.json', () => {});
    surface = getSurface(container);
    // The app has booted once it has published its own model context (ui/update-model-context).
    await waitForCondition(() =>
      (surface.textContent ?? '').includes('Model context: torusKnot (yaw'),
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it('renders the sandboxed MCP app and shows its live telemetry and model context', () => {
    expect(surface.querySelector('a2ui-mcp-app iframe')).toBeTruthy();
    expect(surface.textContent).toContain('3D Geometry Preset');
    expect(surface.textContent).toContain('Captured 3D camera telemetry: torusKnot (yaw=');
    expect(surface.textContent).toContain('Model context: torusKnot (yaw');
  });

  it('switches the geometry from the sibling text field through the data.paths binding', async () => {
    const presetInput = surface.querySelector('input[placeholder="torusKnot"]') as HTMLInputElement;
    expect(presetInput).toBeTruthy();
    presetInput.value = 'crystal';
    presetInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));

    // data-model-update reaches the app, which rebuilds the mesh and writes telemetry
    // (data-model-change) and model context (update-model-context) back for the new preset.
    await waitForCondition(
      () =>
        (surface.textContent ?? '').includes('Captured 3D camera telemetry: crystal (yaw=') &&
        (surface.textContent ?? '').includes('Model context: crystal (yaw'),
    );
  });

  it('lists the MCP App example in the navigation sidebar', () => {
    const navText =
      container.querySelector('[aria-label="Examples Navigation"]')?.textContent ?? '';
    expect(navText).toContain('Mcp App 3d Geometry');
  });
});
