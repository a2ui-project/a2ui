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

/**
 * Integration tests for the standalone VegaChart sample (`a2ui_vegachart.json`).
 *
 * Verifies multi-catalog registration (`basicCatalog` + `vegachartCatalog`),
 * static payload validation, component creation, and reactive data model
 * bindings for `VegaChart` specs.
 */

import {beforeEach, describe, expect, it} from 'vitest';

import {A2uiVegaChartElement} from '@a2ui/catalog-vegachart';
import {DataContext} from '@a2ui/web_core/v0_9';

import {
  A2uiVegachartApp,
  BASIC_CATALOG_ID,
  DASHBOARD_SURFACE_ID,
  VEGACHART_CATALOG_ID,
} from './app.js';

if (!(document as unknown as Record<string, unknown>)['adoptedStyleSheets']) {
  (document as unknown as Record<string, unknown>)['adoptedStyleSheets'] = [];
}
if (
  typeof ShadowRoot !== 'undefined' &&
  !(ShadowRoot.prototype as unknown as Record<string, unknown>)['adoptedStyleSheets']
) {
  (ShadowRoot.prototype as unknown as Record<string, unknown>)['adoptedStyleSheets'] = [];
}

async function bootstrap(app: A2uiVegachartApp) {
  document.body.replaceChildren(app);
  await Promise.resolve();
  await app.updateComplete;
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('the VegaChart sample payload', () => {
  let app: A2uiVegachartApp;

  beforeEach(() => {
    A2uiVegaChartElement.defaultEmbedFn = async () => ({});
    app = new A2uiVegachartApp();
  });

  it('registers both the basic catalog and the VegaChart catalog', async () => {
    await bootstrap(app);

    const supported =
      app.processor.getClientCapabilities({versions: ['v0.9']})['v0.9']?.supportedCatalogIds ?? [];
    expect(supported).toContain(BASIC_CATALOG_ID);
    expect(supported).toContain(VEGACHART_CATALOG_ID);
  });

  it('validates the static payload and creates the dashboard surface without errors', async () => {
    await bootstrap(app);

    expect(app.error).toBe('');
    expect(app.surface).toBeDefined();
    expect(app.surface?.id).toBe(DASHBOARD_SURFACE_ID);
    expect(app.surface?.componentsModel.get('root')).toBeDefined();
    expect(app.surface?.componentsModel.get('revenue_chart')).toBeDefined();
    expect(app.surface?.componentsModel.get('traffic_chart')).toBeDefined();
    expect(app.surface?.componentsModel.get('regional_facet_chart')).toBeDefined();
  });

  it('resolves VegaChart specs from the surface data model and reacts to updates', async () => {
    await bootstrap(app);

    const surface = app.surface!;
    const revenueComp = surface.componentsModel.get('revenue_chart')!;
    expect(revenueComp.type).toBe('VegaChart');
    expect(revenueComp.catalog.id).toBe(VEGACHART_CATALOG_ID);

    const ctx = new DataContext(surface, '/');
    const initialSpec = (await ctx.resolveDynamicValue(revenueComp.properties['spec'])) as Record<
      string,
      unknown
    >;
    expect(initialSpec['description']).toBe(
      'Quarterly revenue by product line in thousands of dollars',
    );

    surface.dataModel.set('/charts/quarterlyRevenue', {
      description: 'Updated annual revenue projection',
      mark: 'line',
      data: {values: [{quarter: 'Q1 2026', revenue: 900}]},
    });

    const updatedSpec = (await ctx.resolveDynamicValue(revenueComp.properties['spec'])) as Record<
      string,
      unknown
    >;
    expect(updatedSpec['description']).toBe('Updated annual revenue projection');
    expect(updatedSpec['mark']).toBe('line');
  });
});
