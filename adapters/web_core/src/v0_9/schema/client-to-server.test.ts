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
import {A2uiClientMessageSchema, A2uiClientDataModelSchema} from './client-to-server.js';

describe('Client-to-Server Schema Verification', () => {
  it('validates a valid action message', () => {
    const validAction = {
      version: 'v0.9',
      action: {
        name: 'submit',
        surfaceId: 's1',
        sourceComponentId: 'c1',
        timestamp: new Date().toISOString(),
        context: {foo: 'bar'},
      },
    };
    const result = A2uiClientMessageSchema.safeParse(validAction);
    assert.ok(result.success, result.success ? '' : result.error.message);
  });

  it('validates a valid error message (validation failed)', () => {
    const validError = {
      version: 'v0.9',
      error: {
        code: 'VALIDATION_FAILED',
        surfaceId: 's1',
        path: '/components/0/text',
        message: 'Too short',
      },
    };
    const result = A2uiClientMessageSchema.safeParse(validError);
    assert.ok(result.success, result.success ? '' : result.error.message);
  });

  it('validates a valid error message (generic)', () => {
    const validError = {
      version: 'v0.9',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
        surfaceId: 's1',
      },
    };
    const result = A2uiClientMessageSchema.safeParse(validError);
    assert.ok(result.success, result.success ? '' : result.error.message);
  });

  it('validates a valid data model message', () => {
    const validDataModel = {
      version: 'v0.9',
      surfaces: {
        s1: {user: 'Alice'},
        s2: {cart: []},
      },
    };
    const result = A2uiClientDataModelSchema.safeParse(validDataModel);
    assert.ok(result.success, result.success ? '' : result.error.message);
  });

  it('fails on invalid version', () => {
    const invalidAction = {
      version: 'v0.8',
      action: {
        name: 'submit',
        surfaceId: 's1',
        sourceComponentId: 'c1',
        timestamp: new Date().toISOString(),
        context: {},
      },
    };
    const result = A2uiClientMessageSchema.safeParse(invalidAction);
    assert.strictEqual(result.success, false);
  });
});
