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

import {describe, expect, it} from 'vitest';

import {SQL_CATALOG_ID} from '../catalog/catalog_id.js';
import {validator} from './test_fixtures.js';

const create = {version: '1.0', createSurface: {surfaceId: 's', catalogId: SQL_CATALOG_ID}};

function update(components: unknown[]) {
  return {version: '1.0', updateComponents: {surfaceId: 's', components}};
}

describe('MessageValidator', () => {
  it('accepts a minimal valid surface', () => {
    expect(
      validator.validate([create, update([{id: 'root', component: 'Text', text: 'hi'}])]),
    ).toEqual({
      ok: true,
      errors: [],
    });
  });

  it('names the component, type and property of schema errors', () => {
    const report = validator.validate([
      create,
      update([{id: 'root', component: 'Text', text: 'hi', variant: 'h1'}]),
    ]);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatchObject({
      surfaceId: 's',
      componentId: 'root',
      component: 'Text',
    });
    expect(report.errors[0]?.message).toContain('/variant');
  });

  it('rejects unknown components, missing root, dangling children and duplicates', () => {
    const report = validator.validate([
      create,
      update([
        {id: 'col', component: 'Column', children: ['missing']},
        {id: 'dup', component: 'Divider'},
        {id: 'dup', component: 'Divider'},
        {id: 'x', component: 'Marquee'},
      ]),
    ]);
    const messages = report.errors.map(error => error.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Unknown component type "Marquee".',
        'Duplicate component id.',
        'No component has the id "root".',
        'Refers to the missing component "missing".',
      ]),
    );
  });

  it('rejects another catalog and malformed envelopes', () => {
    const report = validator.validate([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: 'other'}},
      {version: '0.9', createSurface: {surfaceId: 's'}},
      {version: '1.0', deleteSurface: {surfaceId: 's'}},
      {version: '1.0', updateDataModel: {surfaceId: 's', value: 3}},
    ]);
    expect(report.errors.map(error => error.message)).toEqual([
      `createSurface must use catalogId "${SQL_CATALOG_ID}".`,
      'Each message must be an object with version "1.0".',
      'Each message must have exactly one of createSurface, updateComponents, updateDataModel.',
      'updateDataModel.value must be an object.',
    ]);
  });

  it('validates DataTable and VegaChart properties', () => {
    const report = validator.validate([
      create,
      update([
        {id: 'root', component: 'Column', children: ['t', 'c']},
        {id: 't', component: 'DataTable'},
        {id: 'c', component: 'VegaChart', spec: {'@path': '/chart'}},
      ]),
    ]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({componentId: 't', component: 'DataTable'});
  });
});
