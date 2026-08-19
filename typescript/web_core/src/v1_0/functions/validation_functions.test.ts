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
import assert from 'node:assert';
import {
  RequiredV1_0Implementation,
  RegexV1_0Implementation,
  LengthV1_0Implementation,
  NumericV1_0Implementation,
  EmailV1_0Implementation,
} from './validation_functions.js';

describe('v1.0 Validation Functions (returnType: validationResult)', () => {
  it('RequiredV1_0 returns valid ValidationResult object', () => {
    const validRes = RequiredV1_0Implementation.execute({value: 'hello'}, null as any);
    assert.deepStrictEqual(validRes, {valid: true});

    const invalidRes = RequiredV1_0Implementation.execute({value: ''}, null as any);
    assert.deepStrictEqual(invalidRes, {
      valid: false,
      message: 'This field is required.',
    });
  });

  it('RegexV1_0 returns valid ValidationResult object', () => {
    const validRes = RegexV1_0Implementation.execute(
      {value: '12345', pattern: '^\\d+$'},
      null as any,
    );
    assert.deepStrictEqual(validRes, {valid: true});

    const invalidRes = RegexV1_0Implementation.execute(
      {value: 'abc', pattern: '^\\d+$'},
      null as any,
    );
    assert.deepStrictEqual(invalidRes, {
      valid: false,
      message: 'Value does not match required pattern.',
    });
  });

  it('LengthV1_0 returns valid ValidationResult object', () => {
    const validRes = LengthV1_0Implementation.execute(
      {value: 'test', min: 2, max: 10},
      null as any,
    );
    assert.deepStrictEqual(validRes, {valid: true});

    const tooShort = LengthV1_0Implementation.execute({value: 'a', min: 2}, null as any);
    assert.deepStrictEqual(tooShort, {
      valid: false,
      message: 'Minimum length is 2.',
    });

    const tooLong = LengthV1_0Implementation.execute({value: 'longstring', max: 5}, null as any);
    assert.deepStrictEqual(tooLong, {
      valid: false,
      message: 'Maximum length is 5.',
    });
  });

  it('NumericV1_0 returns valid ValidationResult object', () => {
    const validRes = NumericV1_0Implementation.execute({value: 25, min: 18, max: 65}, null as any);
    assert.deepStrictEqual(validRes, {valid: true});

    const tooLow = NumericV1_0Implementation.execute({value: 15, min: 18}, null as any);
    assert.deepStrictEqual(tooLow, {
      valid: false,
      message: 'Minimum value is 18.',
    });
  });

  it('EmailV1_0 returns valid ValidationResult object', () => {
    const validRes = EmailV1_0Implementation.execute({value: 'user@example.com'}, null as any);
    assert.deepStrictEqual(validRes, {valid: true});

    const invalidRes = EmailV1_0Implementation.execute({value: 'invalid-email'}, null as any);
    assert.deepStrictEqual(invalidRes, {
      valid: false,
      message: 'Must be a valid email address.',
    });
  });
});
