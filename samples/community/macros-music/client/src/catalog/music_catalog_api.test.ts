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

import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {MUSIC_CATALOG_ID, MUSIC_COMPONENT_APIS} from './music_catalog_api';

const catalogJson = JSON.parse(
  readFileSync(new URL('../../../catalog/music_catalog.json', import.meta.url), 'utf8'),
) as {
  catalogId: string;
  components: Record<string, {properties: Record<string, unknown>; required: string[]}>;
};

describe('music catalog', () => {
  it('uses the catalog id from music_catalog.json', () => {
    expect(MUSIC_CATALOG_ID).toBe(catalogJson.catalogId);
  });

  it('declares the same components as music_catalog.json', () => {
    expect(MUSIC_COMPONENT_APIS.map(api => api.name).sort()).toEqual(
      Object.keys(catalogJson.components).sort(),
    );
  });

  for (const api of MUSIC_COMPONENT_APIS) {
    it(`${api.name} has the same properties and required fields as the JSON`, () => {
      const json = catalogJson.components[api.name]!;
      const shape = api.schema.shape as Record<string, {isOptional(): boolean}>;
      const jsonProps = Object.keys(json.properties).filter(p => p !== 'component');
      expect(Object.keys(shape).sort()).toEqual(jsonProps.sort());
      const required = Object.keys(shape).filter(p => !shape[p]!.isOptional());
      expect(required.sort()).toEqual(json.required.filter(p => p !== 'component').sort());
    });
  }
});
