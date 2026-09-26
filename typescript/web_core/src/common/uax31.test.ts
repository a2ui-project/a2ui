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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {isValidUax31Identifier, assertUax31Identifier} from './uax31.js';
import {A2uiCatalogError} from '../errors.js';

describe('uax31 identifier validation', () => {
  it('accepts standard ASCII identifiers and leading underscore', () => {
    assert.strictEqual(isValidUax31Identifier('Button'), true);
    assert.strictEqual(isValidUax31Identifier('my_component_1'), true);
    assert.strictEqual(isValidUax31Identifier('_private'), true);
    assert.strictEqual(isValidUax31Identifier('_'), true);
    assert.strictEqual(isValidUax31Identifier('class'), true);
  });

  it('accepts a single leading @ for reserved system functions', () => {
    assert.strictEqual(isValidUax31Identifier('@index'), true);
    assert.strictEqual(isValidUax31Identifier('@_sys'), true);
    assert.strictEqual(isValidUax31Identifier('@'), false);
    assert.strictEqual(isValidUax31Identifier('@@index'), false);
  });

  it('accepts valid non-ASCII XID identifiers', () => {
    assert.strictEqual(isValidUax31Identifier('Component_ℓ'), true);
    assert.strictEqual(isValidUax31Identifier('Δelta'), true);
  });

  it('rejects empty strings, leading digits, and hyphens or punctuation', () => {
    assert.strictEqual(isValidUax31Identifier(''), false);
    assert.strictEqual(isValidUax31Identifier('123invalid'), false);
    assert.strictEqual(isValidUax31Identifier('my-component'), false);
    assert.strictEqual(isValidUax31Identifier('Component–Name'), false);
    assert.strictEqual(isValidUax31Identifier('prop!'), false);
  });

  it('throws A2uiCatalogError from assertUax31Identifier when invalid', () => {
    assert.doesNotThrow(() =>
      assertUax31Identifier('ValidName', "component identifier: 'ValidName'"),
    );
    assert.throws(
      () => assertUax31Identifier('bad-name', "component identifier: 'bad-name'"),
      (err: unknown) =>
        err instanceof A2uiCatalogError &&
        err.message === "Invalid UAX #31 component identifier: 'bad-name'",
    );
  });
});
