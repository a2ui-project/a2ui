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
import {createVegaChartV1Catalog, VEGACHART_V1_CATALOG_ID} from './index.js';

const validator = createAjvValidator();
const catalog = createVegaChartV1Catalog(validator);
const chart = catalog.components.get('VegaChart')!;

describe('VegaChart v1.0 catalog', () => {
  it('serializes to the canonical catalogs/vegachart/v1/catalog.json', () => {
    assert.deepStrictEqual(catalog.toJson(), catalogJson);
  });

  it('round-trips the canonical schema through Catalog.fromJson', () => {
    const loaded = Catalog.fromJson(catalogJson, undefined, undefined, {validator});
    assert.strictEqual(loaded.id, VEGACHART_V1_CATALOG_ID);
    assert.strictEqual(loaded.protocolVersion, '1.0');
    assert.deepStrictEqual(loaded.toJson(), catalogJson);
  });

  it('validates VegaChart properties', () => {
    const parse = (props: unknown) => {
      const result = chart.schema['~standard'].validate(props);
      if (result instanceof Promise) throw new Error('expected a synchronous schema');
      return result.issues === undefined;
    };
    assert.strictEqual(parse({spec: {mark: 'bar', data: {values: [{x: 'A', y: 10}]}}}), true);
    assert.strictEqual(parse({spec: {'@path': '/s'}, height: {'@path': '/h'}}), true);
    assert.strictEqual(parse({}), false);
    assert.strictEqual(parse({spec: {mark: 'bar'}, unknownProp: true}), false);
  });

  it('exposes the a2ui-vega-chart element', () => {
    assert.strictEqual(chart.name, 'VegaChart');
    assert.strictEqual(chart.tagName, 'a2ui-vega-chart');
    assert.strictEqual(chart.element, A2uiVegaChartElement);
  });

  it('is memoised per validator', () => {
    assert.strictEqual(createVegaChartV1Catalog(validator), catalog);
    assert.notStrictEqual(createVegaChartV1Catalog(createAjvValidator()), catalog);
  });
});
