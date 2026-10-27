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

/**
 * Runs the 3D geometry example of the catalog end to end: the example messages go through
 * the `MessageProcessor` with the basic and MCP catalogs, the `McpApp` renders through the real
 * sandbox proxy, and the test drives the app the way the sibling `TextField` would, by writing
 * the bound preset, then observes what the app writes back through its bindings.
 */

import geometry3dExample from '../../../../../catalogs/mcp/v1/examples/mcp-app-3d-geometry.json' with {type: 'json'};
import {resetMcpCatalogConfig} from '../../src/mcp_catalog_config.js';
import {
  FrameTestHarness,
  parseExampleMessages,
  waitFor,
} from '../../src/testing/frame_test_support.js';

describe('the 3D geometry example', () => {
  let harness: FrameTestHarness;

  beforeEach(async () => {
    harness = new FrameTestHarness(
      'gallery-mcp-app-3d-geometry',
      parseExampleMessages(geometry3dExample),
    );
    await harness.renderComponent('scene3d_app');
  });

  afterEach(() => {
    harness.dispose();
    resetMcpCatalogConfig();
  });

  function modelContext(): Record<string, unknown> | undefined {
    return harness.surface.dataModel.get<Record<string, unknown> | undefined>(
      '/scene3d/modelContext',
    );
  }

  it('syncs live 3D camera telemetry to /scene3d/telemetry in scene3d_app', async () => {
    harness.setData('/scene3d/geometry', 'crystal');

    await waitFor(
      () =>
        String(harness.surface.dataModel.get('/scene3d/telemetry') ?? '').startsWith(
          'crystal (yaw=',
        ),
      'updated 3D telemetry written by scene3d_app',
    );
  });

  it('publishes the scene state to /scene3d/modelContext through ui/update-model-context', async () => {
    // The app publishes its initial state once the bridge is ready...
    await waitFor(
      () => typeof modelContext()?.['yaw'] === 'number',
      'initial model context published by scene3d_app',
    );
    expect(modelContext()?.['geometry']).toBe('torusKnot');

    // ...and again after the preset changes through the sibling binding.
    harness.setData('/scene3d/geometry', 'wave');
    await waitFor(
      () => modelContext()?.['geometry'] === 'wave',
      'model context updated after the preset change',
    );
    const context = modelContext()!;
    expect(typeof context['pitch']).toBe('number');
    expect(typeof context['zoom']).toBe('number');
    expect(context['autoSpin']).toBe(true);
    expect(context['wireframe']).toBe(false);
  });
});
