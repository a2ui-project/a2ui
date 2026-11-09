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

import {ErrorMessageSchema, RendererToAgentMessageSchema} from './schema/renderer-to-agent.js';

/** Wraps an error payload in a v1.0 renderer-to-agent envelope. */
function errorMessage(error: Record<string, unknown>) {
  return {version: '1.0', error};
}

describe('ErrorMessageSchema', () => {
  it('accepts a generic error with a surfaceId', () => {
    const message = errorMessage({code: 'CUSTOM_ERROR', surfaceId: 'main', message: 'failed'});
    assert.strictEqual(ErrorMessageSchema.safeParse(message).success, true);
    assert.strictEqual(RendererToAgentMessageSchema.safeParse(message).success, true);
  });

  it('accepts a generic error with a functionCallId', () => {
    const message = errorMessage({
      code: 'INVALID_FUNCTION_CALL',
      functionCallId: 'req-42',
      message: 'Function is rendererOnly',
    });
    assert.strictEqual(ErrorMessageSchema.safeParse(message).success, true);
    assert.strictEqual(RendererToAgentMessageSchema.safeParse(message).success, true);
  });

  it('rejects a generic error with both surfaceId and functionCallId', () => {
    const message = errorMessage({
      code: 'CUSTOM_ERROR',
      surfaceId: 'main',
      functionCallId: 'req-42',
      message: 'failed',
    });
    assert.strictEqual(ErrorMessageSchema.safeParse(message).success, false);
    assert.strictEqual(RendererToAgentMessageSchema.safeParse(message).success, false);
  });

  it('rejects a generic error with neither surfaceId nor functionCallId', () => {
    const message = errorMessage({code: 'CUSTOM_ERROR', message: 'failed'});
    assert.strictEqual(ErrorMessageSchema.safeParse(message).success, false);
    assert.strictEqual(RendererToAgentMessageSchema.safeParse(message).success, false);
  });

  it('accepts a validation error', () => {
    const message = errorMessage({
      code: 'VALIDATION_FAILED',
      surfaceId: 'main',
      path: '/components/0/text',
      message: 'Expected a string.',
    });
    assert.strictEqual(ErrorMessageSchema.safeParse(message).success, true);
    assert.strictEqual(RendererToAgentMessageSchema.safeParse(message).success, true);
  });
});
