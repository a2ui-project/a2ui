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
import {createAjvValidator} from '@a2ui/validator-ajv';

import {A2uiVegaChartElement} from '../components/vegaChart.js';
import catalogJson from './catalog.json' with {type: 'json'};
import {createVegaChartCatalog, VEGACHART_CATALOG_ID} from './index.js';

const validator = createAjvValidator();
const catalog = createVegaChartCatalog(validator);
const chart = catalog.components.get('VegaChart')!;

describe('VegaChart v0.9 catalog', () => {
  it('serializes to the canonical catalogs/vegachart/v0_9/catalog.json', () => {
    assert.deepStrictEqual(catalog.toJson(), catalogJson);
  });

  it('round-trips the canonical schema through Catalog.fromJson', () => {
    const loaded = Catalog.fromJson(catalogJson, undefined, undefined, {validator});
    assert.strictEqual(loaded.id, VEGACHART_CATALOG_ID);
    assert.deepStrictEqual(loaded.toJson(), catalogJson);
  });

  it('validates VegaChart properties', () => {
    const parse = (props: unknown) => {
      const result = chart.schema['~standard'].validate(props);
      if (result instanceof Promise) throw new Error('expected a synchronous schema');
      return result.issues === undefined;
    };
    assert.strictEqual(parse({spec: {mark: 'bar', data: {values: [{x: 'A', y: 10}]}}}), true);
    assert.strictEqual(parse({spec: {path: '/chart/spec'}, height: 360}), true);
    assert.strictEqual(parse({spec: {path: '/chart/spec'}, height: {path: '/h'}}), true);
    // v1.0-style bindings are not v0.9 DynamicNumbers and must not validate.
    assert.strictEqual(parse({spec: {mark: 'bar'}, height: {'@path': '/h'}}), false);
    assert.strictEqual(parse({}), false);
    assert.strictEqual(parse({spec: {mark: 'bar'}, unknownProp: true}), false);
  });

  it('exposes the a2ui-vega-chart element', () => {
    assert.strictEqual(chart.name, 'VegaChart');
    assert.strictEqual(chart.tagName, 'a2ui-vega-chart');
    assert.strictEqual(chart.element, A2uiVegaChartElement);
    // A copy made with object spread, as renderers make, keeps the element.
    assert.strictEqual({...chart}.tagName, 'a2ui-vega-chart');
  });

  it('is memoised per validator', () => {
    assert.strictEqual(createVegaChartCatalog(validator), catalog);
    assert.notStrictEqual(createVegaChartCatalog(createAjvValidator()), catalog);
  });
});
