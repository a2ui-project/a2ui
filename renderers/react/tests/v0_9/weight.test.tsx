/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it, expect} from 'vitest';
import {renderA2uiComponent} from '../utils';
import {getWeightStyle} from '../../src/v0_9/catalog/basic/utils';
import {Image, Text, Card, Row, Column} from '../../src/v0_9/catalog/basic';

describe('getWeightStyle', () => {
  it('returns empty object when weight is undefined', () => {
    expect(getWeightStyle(undefined)).toEqual({});
  });

  it('returns flex, minWidth, and minHeight when weight is set', () => {
    expect(getWeightStyle(2)).toEqual({flex: '2', minWidth: 0, minHeight: 0});
  });

  it('handles fractional weights', () => {
    expect(getWeightStyle(1.5)).toEqual({flex: '1.5', minWidth: 0, minHeight: 0});
  });

  it('treats weight: 0 as a valid value (a child that does not grow)', () => {
    // Per spec, weight is "similar to flex-grow"; 0 is a meaningful value.
    expect(getWeightStyle(0)).toEqual({flex: '0', minWidth: 0, minHeight: 0});
  });
});

describe('weight property is honored on basic catalog components', () => {
  const cases: Array<{name: string; impl: any; props: Record<string, any>}> = [
    {name: 'Image', impl: Image, props: {url: 'https://example.com/x.png'}},
    {name: 'Text', impl: Text, props: {text: 'hello'}},
    {name: 'Card', impl: Card, props: {child: 'unknown-child'}},
    {name: 'Row', impl: Row, props: {children: []}},
    {name: 'Column', impl: Column, props: {children: []}},
  ];

  for (const {name, impl, props} of cases) {
    it(`${name} applies flex when weight is set`, () => {
      const {view} = renderA2uiComponent(impl, 'c1', {...props, weight: 2});
      const root = view.container.firstChild as HTMLElement;
      expect(root.style.flexGrow).toBe('2');
      expect(root.style.minWidth).toBe('0px');
    });

    it(`${name} does not apply flex when weight is unset`, () => {
      const {view} = renderA2uiComponent(impl, 'c1', props);
      const root = view.container.firstChild as HTMLElement;
      expect(root.style.flex).toBe('');
    });
  }
});
