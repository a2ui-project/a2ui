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
import {
  A2uiVegaChartV1,
  VEGACHART_V1_CATALOG_ID,
  VegaChartV1Api,
  vegachartV1Catalog,
} from './index.js';

describe('VegaChart v1.0 catalog', () => {
  it('serializes to the canonical catalogs/vegachart/v1/catalog.json', () => {
    assert.deepStrictEqual(vegachartV1Catalog.toJson(), catalogJson);
  });

  it('round-trips the canonical schema through Catalog.fromJson', () => {
    const loaded = Catalog.fromJson(catalogJson);
    assert.strictEqual(loaded.id, VEGACHART_V1_CATALOG_ID);
    assert.strictEqual(loaded.protocolVersion, '1.0');
    assert.deepStrictEqual(loaded.toJson(), catalogJson);
  });

  it('validates VegaChart properties', () => {
    const parse = (props: unknown) => VegaChartV1Api.schema.safeParse(props).success;
    assert.strictEqual(parse({spec: {mark: 'bar', data: {values: [{x: 'A', y: 10}]}}}), true);
    assert.strictEqual(parse({spec: {'@path': '/s'}, height: {'@path': '/h'}}), true);
    assert.strictEqual(parse({}), false);
    assert.strictEqual(parse({spec: {mark: 'bar'}, unknownProp: true}), false);
  });

  it('exposes the a2ui-vega-chart element', () => {
    assert.strictEqual(A2uiVegaChartV1.name, 'VegaChart');
    assert.strictEqual(A2uiVegaChartV1.tagName, 'a2ui-vega-chart');
    assert.strictEqual(vegachartV1Catalog.components.get('VegaChart'), A2uiVegaChartV1);
  });
});
