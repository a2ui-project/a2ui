/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Guards for payloads that cross the frame boundary, shared by the `a2ui_*` bridge and the MCP
 * Apps bridge. They implement the JSON payload protection rules of the web app frame
 * specification: no prototype pollution keys, bounded nesting depth and bounded serialized size.
 */

/** Deepest object or array nesting accepted in a message from a frame. */
export const MAX_PAYLOAD_NESTING_DEPTH = 10;
/** Largest serialized message (in JSON characters) accepted from a frame: 64 KB. */
export const MAX_PAYLOAD_SIZE_BYTES = 64 * 1024;
/** Property names that are never accepted anywhere in a message payload. */
export const FORBIDDEN_PROTOTYPE_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Outcome of a security check; `reason` explains a rejection. */
export interface PayloadSecurityResult {
  readonly valid: boolean;
  readonly reason?: string;
}

const VALID: PayloadSecurityResult = {valid: true};

/**
 * Recursively rejects prototype pollution keys and nesting deeper than `maxDepth` levels.
 * Arrays are discriminated before objects so that array elements count as nesting levels too.
 */
function validatePayloadSecurity(
  value: unknown,
  maxDepth = MAX_PAYLOAD_NESTING_DEPTH,
  currentDepth = 0,
): PayloadSecurityResult {
  if (currentDepth > maxDepth) {
    return {
      valid: false,
      reason: `Exceeded maximum allowed nesting depth of ${maxDepth} levels`,
    };
  }

  if (value === null || typeof value !== 'object') {
    return VALID;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = validatePayloadSecurity(item, maxDepth, currentDepth + 1);
      if (!result.valid) {
        return result;
      }
    }
    return VALID;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    if (FORBIDDEN_PROTOTYPE_KEYS.has(key)) {
      return {
        valid: false,
        reason: `Detected forbidden prototype pollution property key: "${key}"`,
      };
    }
    const result = validatePayloadSecurity(record[key], maxDepth, currentDepth + 1);
    if (!result.valid) {
      return result;
    }
  }

  return VALID;
}

/**
 * Checks that a message received from a frame is safe to process: it contains no prototype
 * pollution keys, nests at most {@link MAX_PAYLOAD_NESTING_DEPTH} levels, serializes to JSON and
 * its serialized form is at most {@link MAX_PAYLOAD_SIZE_BYTES} characters long.
 *
 * `null` and `undefined` are accepted; the caller decides what an empty message means.
 */
export function validateMessageSecurity(rawMessage: unknown): PayloadSecurityResult {
  if (rawMessage === null || rawMessage === undefined) {
    return VALID;
  }

  const securityCheck = validatePayloadSecurity(rawMessage);
  if (!securityCheck.valid) {
    return securityCheck;
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(rawMessage);
  } catch {
    return {
      valid: false,
      reason: 'Failed to serialize message payload for size inspection',
    };
  }

  if (serialized && serialized.length > MAX_PAYLOAD_SIZE_BYTES) {
    return {
      valid: false,
      reason: `Message payload exceeds maximum allowed size of ${MAX_PAYLOAD_SIZE_BYTES} bytes (${serialized.length} bytes)`,
    };
  }

  return VALID;
}
