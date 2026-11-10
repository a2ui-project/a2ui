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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {z} from 'zod';
import {
  mapErrorToRendererMessage,
  normalizeJsonPointer,
  extractEnvelopeErrorContext,
} from './message-error-mapper.js';
import {A2uiIntegrityError, A2uiRpcError, A2uiValidationError} from '../errors.js';
import {ErrorMessageSchema} from '../v1_0/schema/renderer-to-agent.js';

describe('message-error-mapper', () => {
  describe('normalizeJsonPointer', () => {
    it('returns undefined for empty or undefined input', () => {
      assert.strictEqual(normalizeJsonPointer(undefined), undefined);
      assert.strictEqual(normalizeJsonPointer(''), undefined);
    });

    it('preserves paths starting with / literally without stripping action prefixes or replacing dots', () => {
      assert.strictEqual(normalizeJsonPointer('/user.profile/email'), '/user.profile/email');
      assert.strictEqual(normalizeJsonPointer('/createSurface/title'), '/createSurface/title');
      assert.strictEqual(
        normalizeJsonPointer('/updateComponents/createSurface'),
        '/updateComponents/createSurface',
      );
      assert.strictEqual(normalizeJsonPointer('/'), '/');
    });

    it('converts dot and bracket notation paths and strips action prefix', () => {
      assert.strictEqual(
        normalizeJsonPointer('updateComponents.components[0].text'),
        '/components/0/text',
      );
      assert.strictEqual(normalizeJsonPointer('createSurface.title'), '/title');
      assert.strictEqual(normalizeJsonPointer('components[2].label'), '/components/2/label');
    });
  });

  describe('extractEnvelopeErrorContext', () => {
    it('extracts surfaceId, functionCallId, and version from payloads', () => {
      const v1Msg = {
        version: '1.0',
        callRendererFunction: {
          functionCallId: 'call-123',
          surfaceId: 'surface-abc',
        },
      };
      const ctx = extractEnvelopeErrorContext(v1Msg);
      assert.strictEqual(ctx.version, '1.0');
      assert.strictEqual(ctx.functionCallId, 'call-123');
      assert.strictEqual(ctx.surfaceId, 'surface-abc');
      assert.strictEqual(ctx.actionType, 'callRendererFunction');
      assert.strictEqual(ctx.isCallRendererFunction, true);
    });

    it('extracts context from standard actions', () => {
      const msg = {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'surf-1',
          components: [],
        },
      };
      const ctx = extractEnvelopeErrorContext(msg);
      assert.strictEqual(ctx.version, 'v0.9');
      assert.strictEqual(ctx.surfaceId, 'surf-1');
      assert.strictEqual(ctx.actionType, 'updateComponents');
      assert.strictEqual(ctx.isCallRendererFunction, false);
    });
  });

  describe('mapErrorToRendererMessage', () => {
    it('defaults path to / for validation errors when rawPath is undefined', () => {
      const valErr = new A2uiValidationError('Validation failed without path');
      const mapped = mapErrorToRendererMessage(valErr, {version: '1.0', surfaceId: 'surf-1'});

      assert.strictEqual(mapped.version, '1.0');
      assert.strictEqual(mapped.error.code, 'VALIDATION_FAILED');
      assert.strictEqual(mapped.error.path, '/');
      assert.strictEqual(mapped.error.surfaceId, 'surf-1');

      const parsed = ErrorMessageSchema.safeParse(mapped);
      assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    });

    it('defaults path to / for UNALLOWED_PARENT and UNALLOWED_CHILD', () => {
      const parentErr = new A2uiValidationError('Unallowed parent', undefined, 'UNALLOWED_PARENT');
      const mapped = mapErrorToRendererMessage(parentErr, {version: '1.0', surfaceId: 'surf-1'});
      assert.strictEqual(mapped.error.code, 'UNALLOWED_PARENT');
      assert.strictEqual(mapped.error.path, '/');

      const parsed = ErrorMessageSchema.safeParse(mapped);
      assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    });

    it('escapes RFC 6901 ~ and / tokens from Zod issue paths', () => {
      const zodError = new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ['components', 'prop/with/slash', 'key~with~tilde'],
          message: 'Invalid property value',
        },
      ]);
      const valErr = new A2uiValidationError('Schema failure', zodError);
      const mapped = mapErrorToRendererMessage(valErr, {
        version: '1.0',
        surfaceId: 'surf-1',
      });
      assert.strictEqual(mapped.error.path, '/components/prop~1with~1slash/key~0with~0tilde');
    });

    it('routes pre-1.0 callRendererFunction payload failures to VALIDATION_FAILED with surfaceId', () => {
      const err = new A2uiValidationError(
        'Unsupported action: callRendererFunction',
        undefined,
        'VALIDATION_ERROR',
        {path: '/version'},
      );
      const mapped = mapErrorToRendererMessage(err, {
        version: 'v0.9',
        actionType: 'callRendererFunction',
        isCallRendererFunction: true,
        surfaceId: 'surf-pre10',
      });

      assert.strictEqual(mapped.version, 'v0.9');
      assert.strictEqual(mapped.error.code, 'VALIDATION_FAILED');
      assert.strictEqual(mapped.error.surfaceId, 'surf-pre10');
      assert.strictEqual(mapped.error.path, '/version');
    });

    it('satisfies v1.0 oneOf constraint when functionCallId is present', () => {
      const rpcErr = new A2uiRpcError('Function not found', 'INVALID_FUNCTION_CALL', 'fn-123');
      const mapped = mapErrorToRendererMessage(rpcErr, {
        version: '1.0',
        functionCallId: 'fn-123',
        surfaceId: 'surf-should-be-omitted',
      });

      assert.strictEqual(mapped.version, '1.0');
      assert.strictEqual(mapped.error.code, 'INVALID_FUNCTION_CALL');
      assert.strictEqual(mapped.error.functionCallId, 'fn-123');
      assert.strictEqual(mapped.error.surfaceId, undefined);
      assert.strictEqual(mapped.error.message, rpcErr.message);
    });

    it('satisfies v1.0 oneOf constraint when functionCallId is absent but surfaceId is present', () => {
      const rpcErr = new A2uiRpcError('Function invocation failed', 'INVALID_FUNCTION_CALL');
      const mapped = mapErrorToRendererMessage(rpcErr, {
        version: '1.0',
        surfaceId: 'surf-1',
      });

      assert.strictEqual(mapped.version, '1.0');
      assert.strictEqual(mapped.error.code, 'INVALID_FUNCTION_CALL');
      assert.strictEqual(mapped.error.surfaceId, 'surf-1');
      assert.strictEqual(mapped.error.functionCallId, undefined);
      assert.strictEqual(mapped.error.message, rpcErr.message);
    });

    it('maps non-validation errors to GenericError with surfaceId', () => {
      const integrityErr = new A2uiIntegrityError('Duplicate component id: comp-1');
      const mapped = mapErrorToRendererMessage(integrityErr, {
        version: '1.0',
        surfaceId: 'surf-1',
      });

      assert.strictEqual(mapped.version, '1.0');
      assert.strictEqual(mapped.error.code, 'INTEGRITY_ERROR');
      assert.strictEqual(mapped.error.surfaceId, 'surf-1');
      assert.strictEqual(mapped.error.functionCallId, undefined);
      assert.strictEqual(mapped.error.message, 'Duplicate component id: comp-1');
    });
  });
});
