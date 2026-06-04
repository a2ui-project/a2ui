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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {DataValueSchema, createDataValueSchema} from './common-types.js';

describe('DataValueSchema recursion depth', () => {
  it('should allow depth <= 5 by default', () => {
    const validData = {
      key: 'root',
      valueMap: [
        {
          key: 'level2',
          valueMap: [
            {
              key: 'level3',
              valueMap: [
                {
                  key: 'level4',
                  valueMap: [
                    {
                      key: 'level5',
                      valueString: 'leaf',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = DataValueSchema.safeParse(validData);
    assert.strictEqual(result.success, true);
  });

  it('should reject depth > 5 by default', () => {
    const invalidData = {
      key: 'root',
      valueMap: [
        {
          key: 'level2',
          valueMap: [
            {
              key: 'level3',
              valueMap: [
                {
                  key: 'level4',
                  valueMap: [
                    {
                      key: 'level5',
                      valueMap: [
                        {
                          key: 'level6',
                          valueString: 'leaf',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = DataValueSchema.safeParse(invalidData);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        result.error.issues[0].message,
        'valueMap recursion exceeded maximum depth of 5.',
      );
    }
  });

  it('should allow overriding depth limit', () => {
    const CustomSchema = createDataValueSchema({maxDepth: 2});

    const validData = {
      key: 'root',
      valueMap: [
        {
          key: 'level2',
          valueString: 'leaf',
        },
      ],
    };

    const invalidData = {
      key: 'root',
      valueMap: [
        {
          key: 'level2',
          valueMap: [
            {
              key: 'level3',
              valueString: 'leaf',
            },
          ],
        },
      ],
    };

    const validResult = CustomSchema.safeParse(validData);
    assert.strictEqual(validResult.success, true);

    const invalidResult = CustomSchema.safeParse(invalidData);
    assert.strictEqual(invalidResult.success, false);
    if (!invalidResult.success) {
      assert.strictEqual(
        invalidResult.error.issues[0].message,
        'valueMap recursion exceeded maximum depth of 2.',
      );
    }
  });
});
