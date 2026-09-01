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

import {z} from 'zod';
import {InternalOperation} from '../operations.js';
import {A2uiValidationError} from '../../errors.js';
import {formatZodIssue} from '../message-processor.js';

/**
 * Union of supported A2UI protocol version strings.
 */
export type ProtocolVersion = 'v0.8' | 'v0.9' | 'v0.9.1' | 'v1.0' | (string & {});

/**
 * Resolves a version adapter for a given protocol version or raw payload.
 */
export interface VersionAdapterResolver {
  /** Resolves an adapter by protocol version string. */
  getAdapter(version: ProtocolVersion | string): VersionAdapter;
  /** Resolves an adapter from a raw message payload. */
  resolveFromPayload(payload: unknown): VersionAdapter;
}

/**
 * Isolates protocol syntax differences across specification versions.
 */
export interface VersionAdapter {
  /** Protocol version string supported by this adapter (e.g. 'v1.0'). */
  readonly version: ProtocolVersion;

  /**
   * Converts a raw message payload or payload list into canonical internal operations.
   *
   * @param payload The raw JSON message payload or message array.
   * @returns Array of canonical internal operations.
   */
  extractOperations(payload: unknown): InternalOperation[];
}

const ALL_KNOWN_ACTION_KEYS = [
  'beginRendering',
  'surfaceUpdate',
  'dataModelUpdate',
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
  'callRendererFunction',
  'agentFunctionResponse',
] as const;

function validateActionSurfaceIds(
  msgObj: Record<string, unknown>,
  actionKeys: readonly string[],
): void {
  for (const key of actionKeys) {
    const actionVal = msgObj[key];
    if (actionVal && typeof actionVal === 'object') {
      const actionObj = actionVal as Record<string, unknown>;
      if (
        'surfaceId' in actionObj &&
        actionObj.surfaceId !== undefined &&
        typeof actionObj.surfaceId !== 'string'
      ) {
        throw new A2uiValidationError('surfaceId must be a string');
      }
    }
  }
}

/**
 * Base abstract class providing common payload unwrapping, schema validation,
 * and error formatting for protocol version adapters.
 */
export abstract class BaseVersionAdapter implements VersionAdapter {
  abstract readonly version: ProtocolVersion;
  protected abstract readonly schema: z.ZodTypeAny;

  protected abstract getNativeActionKeys(): string[];

  extractOperations(payload: unknown): InternalOperation[] {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload)) {
      return payload.flatMap(item => this.extractOperations(item));
    }
    const msgObj = payload as Record<string, unknown>;
    if (Array.isArray(msgObj.messages)) {
      return this.extractOperations(msgObj.messages);
    }

    validateActionSurfaceIds(msgObj, ALL_KNOWN_ACTION_KEYS);

    const nativeActionKeys = this.getNativeActionKeys();
    const presentNativeKeys = nativeActionKeys.filter(k => k in msgObj);
    const presentOtherKnownKeys = ALL_KNOWN_ACTION_KEYS.filter(
      k => !nativeActionKeys.includes(k) && k in msgObj,
    );

    if (presentNativeKeys.length > 1) {
      throw new A2uiValidationError(
        `Message contains multiple conflicting update actions: ${presentNativeKeys.join(', ')}.`,
      );
    }

    // Ignore cross-version messages
    if (presentNativeKeys.length === 0 && presentOtherKnownKeys.length > 0) {
      return [];
    }

    const preparedPayload = this.preparePayloadForValidation(msgObj);
    const parseResult = this.schema.safeParse(preparedPayload);
    if (!parseResult.success) {
      const formattedErrors = parseResult.error.errors.map(formatZodIssue).join('; ');
      throw new A2uiValidationError(
        `Invalid ${this.version} message: ${formattedErrors}`,
        parseResult.error,
      );
    }

    return this.extractOperationsFromObject(msgObj);
  }

  /**
   * Normalizes the message object before running schema validation.
   *
   * Defaults to attaching `version` if not present.
   *
   * @param msgObj Raw message object.
   * @returns Normalized message payload for schema validation.
   */
  protected preparePayloadForValidation(msgObj: Record<string, unknown>): Record<string, unknown> {
    return 'version' in msgObj ? msgObj : {version: this.version, ...msgObj};
  }

  /**
   * Converts a validated message object into canonical internal operations.
   *
   * @param msgObj Validated message payload.
   * @returns Array of canonical internal operations.
   */
  protected abstract extractOperationsFromObject(
    msgObj: Record<string, unknown>,
  ): InternalOperation[];
}
