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

import '../test/dom.js';

import * as assert from 'node:assert';
import {describe, it} from 'node:test';

import {Catalog} from '@a2ui/web_core/v1_0';

import catalogJson from './catalog.json' with {type: 'json'};
import {A2uiVegaChart, VEGACHART_CATALOG_ID, VegaChartApi, vegachartCatalog} from './index.js';

describe('VegaChart v0.9 catalog', () => {
  it('serializes to the canonical catalogs/vegachart/v0_9/catalog.json', () => {
    assert.deepStrictEqual(vegachartCatalog.toJson(), catalogJson);
  });

  it('round-trips the canonical schema through Catalog.fromJson', () => {
    const loaded = Catalog.fromJson(catalogJson);
    assert.strictEqual(loaded.id, VEGACHART_CATALOG_ID);
    assert.deepStrictEqual(loaded.toJson(), catalogJson);
  });

  it('validates VegaChart properties', () => {
    const parse = (props: unknown) => VegaChartApi.schema.safeParse(props).success;
    assert.strictEqual(parse({spec: {mark: 'bar', data: {values: [{x: 'A', y: 10}]}}}), true);
    assert.strictEqual(parse({spec: {path: '/chart/spec'}, height: 360}), true);
    assert.strictEqual(parse({spec: {path: '/chart/spec'}, height: {path: '/h'}}), true);
    // v1.0-style bindings are not v0.9 DynamicNumbers and must not validate.
    assert.strictEqual(parse({spec: {mark: 'bar'}, height: {'@path': '/h'}}), false);
    assert.strictEqual(parse({}), false);
    assert.strictEqual(parse({spec: {mark: 'bar'}, unknownProp: true}), false);
  });

  it('exposes the a2ui-vega-chart element', () => {
    assert.strictEqual(A2uiVegaChart.name, 'VegaChart');
    assert.strictEqual(A2uiVegaChart.tagName, 'a2ui-vega-chart');
    assert.strictEqual(vegachartCatalog.components.get('VegaChart'), A2uiVegaChart);
  });
});
