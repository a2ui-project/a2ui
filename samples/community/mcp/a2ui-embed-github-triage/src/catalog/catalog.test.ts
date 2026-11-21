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

import {TRIAGE_CATALOG_ID, triageCatalog} from './index.js';

describe('triageCatalog', () => {
  it('has the basic components without Icon, the GitHub components and VegaChart', () => {
    expect(triageCatalog.id).toBe(TRIAGE_CATALOG_ID);
    const names = [...triageCatalog.components.keys()];
    expect(names).toEqual(
      expect.arrayContaining([
        'Text',
        'List',
        'Modal',
        'Tabs',
        'CheckBox',
        'ChoicePicker',
        'TextField',
        'Slider',
        'DateTimeInput',
        'LabelChip',
        'Avatar',
        'CheckStatus',
        'DiffStat',
        'VegaChart',
      ]),
    );
    expect(names).not.toContain('Icon');
    for (const name of [
      'formatString',
      'formatNumber',
      'pluralize',
      'regex',
      'required',
      'or',
      'not',
    ]) {
      expect(triageCatalog.functions.has(name)).toBe(true);
    }
  });

  it('declares the required properties of the custom components', () => {
    const components = triageCatalog.validationSchema['components'] as Record<
      string,
      {required: string[]}
    >;
    expect(components['LabelChip']?.required).toEqual(expect.arrayContaining(['name']));
    expect(components['Avatar']?.required).toEqual(expect.arrayContaining(['login']));
    expect(components['CheckStatus']?.required).toEqual(expect.arrayContaining(['state']));
    expect(components['DiffStat']?.required).toEqual(
      expect.arrayContaining(['additions', 'deletions']),
    );
  });
});
