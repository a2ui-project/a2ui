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
import {DataContext} from '../../../rendering/data-context.js';
import {
  RequiredV1Point0Implementation,
  RegexV1Point0Implementation,
  LengthV1Point0Implementation,
  NumericV1Point0Implementation,
  EmailV1Point0Implementation,
} from './validation_functions.js';

const dummyContext = null as unknown as DataContext;

describe('v1.0 Validation Functions (returnType: validationResult)', () => {
  it('RequiredV1Point0 returns valid ValidationResult object', () => {
    const validRes = RequiredV1Point0Implementation.execute({value: 'hello'}, dummyContext);
    assert.deepStrictEqual(validRes, {valid: true});

    const invalidRes = RequiredV1Point0Implementation.execute({value: ''}, dummyContext);
    assert.deepStrictEqual(invalidRes, {
      valid: false,
      message: 'This field is required.',
    });
  });

  it('RegexV1Point0 returns valid ValidationResult object', () => {
    const validRes = RegexV1Point0Implementation.execute(
      {value: '12345', pattern: '^\\d+$'},
      dummyContext,
    );
    assert.deepStrictEqual(validRes, {valid: true});

    const invalidRes = RegexV1Point0Implementation.execute(
      {value: 'abc', pattern: '^\\d+$'},
      dummyContext,
    );
    assert.deepStrictEqual(invalidRes, {
      valid: false,
      message: 'Value does not match required pattern.',
    });
  });

  it('LengthV1Point0 returns valid ValidationResult object', () => {
    const validRes = LengthV1Point0Implementation.execute(
      {value: 'test', min: 2, max: 10},
      dummyContext,
    );
    assert.deepStrictEqual(validRes, {valid: true});

    const tooShort = LengthV1Point0Implementation.execute({value: 'a', min: 2}, dummyContext);
    assert.deepStrictEqual(tooShort, {
      valid: false,
      message: 'Minimum length is 2.',
    });

    const tooLong = LengthV1Point0Implementation.execute(
      {value: 'longstring', max: 5},
      dummyContext,
    );
    assert.deepStrictEqual(tooLong, {
      valid: false,
      message: 'Maximum length is 5.',
    });
  });

  it('NumericV1Point0 returns valid ValidationResult object', () => {
    const validRes = NumericV1Point0Implementation.execute(
      {value: 25, min: 18, max: 65},
      dummyContext,
    );
    assert.deepStrictEqual(validRes, {valid: true});

    const tooLow = NumericV1Point0Implementation.execute({value: 15, min: 18}, dummyContext);
    assert.deepStrictEqual(tooLow, {
      valid: false,
      message: 'Minimum value is 18.',
    });
  });

  it('EmailV1Point0 returns valid ValidationResult object', () => {
    const validRes = EmailV1Point0Implementation.execute({value: 'user@example.com'}, dummyContext);
    assert.deepStrictEqual(validRes, {valid: true});

    const invalidRes = EmailV1Point0Implementation.execute({value: 'invalid-email'}, dummyContext);
    assert.deepStrictEqual(invalidRes, {
      valid: false,
      message: 'Must be a valid email address.',
    });
  });

  it('RequiredV1Point0 schema accepts undefined value without throwing and returns invalid result', () => {
    const parsedArgs = RequiredV1Point0Implementation.schema.parse({});
    const res = RequiredV1Point0Implementation.execute(parsedArgs, null as any);
    assert.deepStrictEqual(res, {
      valid: false,
      message: 'This field is required.',
    });
  });

  it('NumericV1Point0 schema parses empty string and null as NaN and returns invalid result', () => {
    const parsedEmpty = NumericV1Point0Implementation.schema.parse({value: '', min: 0});
    const emptyRes = NumericV1Point0Implementation.execute(parsedEmpty, null as any);
    assert.deepStrictEqual(emptyRes, {
      valid: false,
      message: 'Value must be a valid number.',
    });

    const parsedNull = NumericV1Point0Implementation.schema.parse({value: null, min: 0});
    const nullRes = NumericV1Point0Implementation.execute(parsedNull, null as any);
    assert.deepStrictEqual(nullRes, {
      valid: false,
      message: 'Value must be a valid number.',
    });
  });

  it('RegexV1Point0 schema coerces null value safely to empty string', () => {
    const parsed = RegexV1Point0Implementation.schema.parse({value: null, pattern: '^.+$'});
    const res = RegexV1Point0Implementation.execute(parsed, null as any);
    assert.deepStrictEqual(res, {
      valid: false,
      message: 'Value does not match required pattern.',
    });
  });
});
