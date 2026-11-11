/*
 * Copyright 2026 Google LLC
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
import {themeConfig, withPlainFieldNames} from './vega_chart.js';
import {theme} from './theme.js';

describe('withPlainFieldNames', () => {
  it('adds the plain field next to time-unit keys and keeps other keys', () => {
    expect(withPlainFieldNames({yearmonth_date: [1, 2], region: ['EMEA']})).toEqual({
      yearmonth_date: [1, 2],
      date: [1, 2],
      region: ['EMEA'],
    });
    expect(withPlainFieldNames({utcyearmonthdate_day: [3, 4]})).toEqual({
      utcyearmonthdate_day: [3, 4],
      day: [3, 4],
    });
    expect(withPlainFieldNames({date: [0, 1], yearmonth_date: [5, 6]})).toEqual({
      date: [0, 1],
      yearmonth_date: [5, 6],
    });
    expect(withPlainFieldNames({})).toEqual({});
    expect(withPlainFieldNames(3)).toBe(3);
  });
});

describe('themeConfig', () => {
  it('takes the mark color and the palette from the theme', () => {
    const config = themeConfig(theme) as {mark: {color: string}; range: {category: string[]}};

    expect(config.mark.color).toBe(theme.colors.primary);
    expect(config.range.category[0]).toBe(theme.colors.primary);
  });
});
