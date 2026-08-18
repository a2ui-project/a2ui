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
 * Isolates protocol syntax differences across specification versions.
 */
export interface VersionAdapter {
  /** The protocol version string supported by this adapter (e.g. 'v1.0'). */
  readonly version: ProtocolVersion;

  /**
   * Converts a raw message payload or payload list into canonical internal operations.
   *
   * @param payload The raw JSON message payload or message array.
   * @returns Array of canonical internal operations.
   */
  extractOperations(payload: unknown): InternalOperation[];
}

/**
 * Base abstract class providing common payload unwrapping, Zod safeParse validation,
 * and error formatting for protocol version adapters.
 */
export abstract class BaseVersionAdapter implements VersionAdapter {
  abstract readonly version: ProtocolVersion;
  protected abstract readonly schema: z.ZodTypeAny;

  extractOperations(payload: unknown): InternalOperation[] {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload)) {
      return payload.flatMap(item => this.extractOperations(item));
    }
    const msgObj = payload as Record<string, unknown>;
    if (Array.isArray(msgObj.messages)) {
      return this.extractOperations(msgObj.messages);
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
   * Defaults to attaching `version` if not present.
   */
  protected preparePayloadForValidation(msgObj: Record<string, unknown>): Record<string, unknown> {
    return 'version' in msgObj ? msgObj : {version: this.version, ...msgObj};
  }

  /**
   * Converts a validated message object into canonical internal operations.
   */
  protected abstract extractOperationsFromObject(
    msgObj: Record<string, unknown>,
  ): InternalOperation[];
}
