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

import {describe, it, expect} from 'vitest';
import {z} from 'zod';
import {createComponentImplementation} from '../../src/v0_9/adapter';
import {isReactComponentImplementation} from '../../src/v0_9/is_react_component_implementation';

describe('isReactComponentImplementation', () => {
  it('returns true for valid ReactComponentImplementation', () => {
    const impl = createComponentImplementation(
      {name: 'ValidBox', schema: z.object({})},
      () => null,
    );
    expect(isReactComponentImplementation(impl)).toBe(true);
  });

  it('returns false for null, undefined, and primitives', () => {
    expect(isReactComponentImplementation(null)).toBe(false);
    expect(isReactComponentImplementation(undefined)).toBe(false);
    expect(isReactComponentImplementation('render')).toBe(false);
    expect(isReactComponentImplementation(123)).toBe(false);
    expect(isReactComponentImplementation(true)).toBe(false);
  });

  it('returns false for plain objects lacking a render function', () => {
    expect(isReactComponentImplementation({})).toBe(false);
    expect(isReactComponentImplementation({render: 'not-a-function'})).toBe(false);
    expect(isReactComponentImplementation({name: 'Box'})).toBe(false);
  });

  it('returns false for arrays (even if monkey-patched with a render function)', () => {
    expect(isReactComponentImplementation([])).toBe(false);
    const arrWithRender = [1, 2, 3] as unknown as {render: unknown};
    arrWithRender.render = () => null;
    expect(isReactComponentImplementation(arrWithRender)).toBe(false);
  });
});
