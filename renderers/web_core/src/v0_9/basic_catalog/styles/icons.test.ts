/*
 * Copyright 2026 Google LLC
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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';

import {toMaterialSymbol} from './icons.js';

describe('toMaterialSymbol', () => {
  it('converts camelCase names to snake_case', () => {
    assert.strictEqual(toMaterialSymbol('shoppingCart'), 'shopping_cart');
    assert.strictEqual(toMaterialSymbol('skipPrevious'), 'skip_previous');
  });

  it('leaves already-lowercase names unchanged', () => {
    assert.strictEqual(toMaterialSymbol('home'), 'home');
    assert.strictEqual(toMaterialSymbol('search'), 'search');
  });

  it('does not produce a leading underscore for PascalCase input', () => {
    assert.strictEqual(toMaterialSymbol('ShoppingCart'), 'shopping_cart');
  });

  it('applies the explicit ligature overrides', () => {
    assert.strictEqual(toMaterialSymbol('play'), 'play_arrow');
    assert.strictEqual(toMaterialSymbol('rewind'), 'fast_rewind');
    assert.strictEqual(toMaterialSymbol('favoriteOff'), 'favorite_border');
    assert.strictEqual(toMaterialSymbol('starOff'), 'star_border');
  });
});
