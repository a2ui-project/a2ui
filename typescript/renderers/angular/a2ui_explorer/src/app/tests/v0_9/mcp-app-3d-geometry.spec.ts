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

import {ApplicationRef} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {getCanvas, loadExample, waitForCondition, Version} from '../utils';

/**
 * The 3D geometry example: a canvas renderer inside the sandboxed `McpApp`, driven through its
 * `data.paths` bindings. The iframe is opaque-origin, so the test types in the sibling preset
 * `TextField` and reads what the app writes back to the sibling `Text` components.
 */
describe('Example: MCP App 3D geometry', () => {
  let canvas: HTMLElement;
  let appRef: ApplicationRef;

  beforeEach(async () => {
    await loadExample({
      name: 'MCP App 3D geometry',
      version: Version.V0_9,
    });
    appRef = TestBed.inject(ApplicationRef);
    appRef.tick();
    canvas = getCanvas();
    // The app has booted once it has published its own model context (ui/update-model-context).
    const ready = await waitForCondition(() => {
      appRef.tick();
      return (canvas.textContent ?? '').includes('Model context: torusKnot (yaw');
    }, 3000);
    expect(ready).withContext('Expected the MCP app to publish its model context').toBeTrue();
  });

  it('renders the sandboxed MCP app and shows its live telemetry and model context', () => {
    const textContent = canvas.textContent ?? '';
    expect(canvas.querySelector('a2ui-mcp-app iframe')).toBeTruthy();
    expect(textContent).toContain('3D Geometry Preset');
    expect(textContent).toContain('Captured 3D camera telemetry: torusKnot (yaw=');
    expect(textContent).toContain('Model context: torusKnot (yaw');
  });

  it('switches the geometry from the sibling text field through the data.paths binding', async () => {
    const presetInput = canvas.querySelector('input[placeholder="torusKnot"]') as HTMLInputElement;
    expect(presetInput).toBeTruthy();
    presetInput.value = 'crystal';
    presetInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));

    // data-model-update reaches the app, which rebuilds the mesh and writes telemetry
    // (data-model-change) and model context (update-model-context) back for the new preset.
    const switched = await waitForCondition(() => {
      appRef.tick();
      const text = canvas.textContent ?? '';
      return (
        text.includes('Captured 3D camera telemetry: crystal (yaw=') &&
        text.includes('Model context: crystal (yaw')
      );
    }, 3000);
    expect(switched).withContext('Expected the crystal preset to reach the app').toBeTrue();
  });

  it('lists the MCP App example in the sidebar', () => {
    const sidebarText = document.querySelector('.example-list')?.textContent ?? '';
    expect(sidebarText).toContain('MCP App 3D geometry');
  });
});
