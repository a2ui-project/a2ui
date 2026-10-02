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
import {z} from 'zod';
import {Catalog} from '../catalog/types.js';
import {PayloadValidator} from './payload-validator.js';
import {STRICT_VALIDATION} from './integrity-checker.js';
import {A2uiValidationError} from '../errors.js';

describe('PayloadValidator', () => {
  it('throws A2uiValidationError when validateFunction args exceed MAX_FUNCTION_CALL_ARGS (1000)', () => {
    const cat = new Catalog(
      'https://example.com/v10',
      '1.0',
      [],
      [{name: 'upper', returnType: 'string', schema: z.object({}).passthrough()}],
    );
    const validator = new PayloadValidator(cat, STRICT_VALIDATION);
    const exactLimitArgs = Object.fromEntries(
      Array.from({length: 1000}, (_, i) => [`arg_${i}`, 'val']),
    );
    const oversizedArgs = Object.fromEntries(
      Array.from({length: 1001}, (_, i) => [`arg_${i}`, 'val']),
    );

    assert.doesNotThrow(() => validator.validateFunction('upper', exactLimitArgs));
    assert.throws(
      () => validator.validateFunction('upper', oversizedArgs),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        err.message.includes('exceeds maximum allowed arguments count (1000)'),
    );
  });
});
