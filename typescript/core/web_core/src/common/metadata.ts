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

import {A2uiValidationError} from '../errors.js';
import {isValidUax31Identifier} from './uax31.js';

/**
 * Read-only map of vendor or official extension payloads keyed by UAX #31
 * Unicode identifiers.
 */
export type Extensions = Readonly<Record<string, unknown>>;

/**
 * Envelope metadata attached to surfaces, components, catalog definitions,
 * or outbound renderer actions.
 */
export interface A2uiMetadata {
  /** Optional extension payloads keyed by UAX #31 Unicode identifiers. */
  readonly extensions?: Extensions;
  /** Additional envelope metadata properties. */
  readonly [key: string]: unknown;
}

/**
 * Options passed when invoking a bound {@link NodeAction} closure.
 */
export interface ActionDispatchOptions {
  /** Optional metadata to attach to the outbound renderer action. */
  readonly metadata?: A2uiMetadata;
}

/** Checks whether a value is a non-null, non-array plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates an `extensions` map and its UAX #31 keys. */
function validateExtensionsMap(extensions: unknown): void {
  if (!isPlainObject(extensions)) {
    throw new A2uiValidationError('Invalid metadata.extensions: expected a plain object.');
  }
  for (const key of Object.keys(extensions)) {
    if (!isValidUax31Identifier(key)) {
      throw new A2uiValidationError(
        `Invalid UAX #31 extension identifier: "${key}". Keys MUST be Unicode identifiers (UAX #31).`,
      );
    }
  }
}

/**
 * Validates an {@link A2uiMetadata} object and its `extensions` keys.
 *
 * @param metadata Metadata candidate to validate. `undefined` is permitted.
 * @throws {A2uiValidationError} When `metadata` is not a plain object or any
 *     `extensions` key is not a valid UAX #31 identifier.
 */
export function validateMetadata(metadata: unknown): asserts metadata is A2uiMetadata | undefined {
  if (metadata === undefined) return;
  if (!isPlainObject(metadata)) {
    throw new A2uiValidationError('Invalid metadata: expected a plain object.');
  }
  for (const key of Object.keys(metadata)) {
    if (key !== 'extensions') {
      throw new A2uiValidationError(
        `Unexpected property "${key}" in metadata; only "extensions" is allowed.`,
      );
    }
  }
  if ('extensions' in metadata && metadata.extensions !== undefined) {
    validateExtensionsMap(metadata.extensions);
  }
}

/** Deep-clones and recursively freezes a JSON-compatible value. */
function cloneAndFreezeValue<T>(value: T): T {
  if (Array.isArray(value)) {
    const clonedArray = value.map(item => cloneAndFreezeValue(item));
    return Object.freeze(clonedArray) as unknown as T;
  }
  if (isPlainObject(value)) {
    const clonedObj: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        Object.defineProperty(clonedObj, key, {
          value: cloneAndFreezeValue(entry),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return Object.freeze(clonedObj) as unknown as T;
  }
  return value;
}

/**
 * Validates and merges action payload `metadata` with call-site `metadata`.
 * Call-site extension keys take precedence over payload extension keys.
 */
export function mergeActionMetadata(
  payloadMetadata: unknown,
  callSiteMetadata: A2uiMetadata | undefined,
): A2uiMetadata | undefined {
  validateMetadata(payloadMetadata);
  validateMetadata(callSiteMetadata);
  if (payloadMetadata === undefined && callSiteMetadata === undefined) {
    return undefined;
  }
  if (payloadMetadata === undefined) {
    return cloneMetadata(callSiteMetadata);
  }
  if (callSiteMetadata === undefined) {
    return cloneMetadata(payloadMetadata);
  }
  const mergedExtensions: Record<string, unknown> = {};
  if (isPlainObject(payloadMetadata.extensions)) {
    for (const [key, val] of Object.entries(payloadMetadata.extensions)) {
      Object.defineProperty(mergedExtensions, key, {
        value: val,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  if (isPlainObject(callSiteMetadata.extensions)) {
    for (const [key, val] of Object.entries(callSiteMetadata.extensions)) {
      Object.defineProperty(mergedExtensions, key, {
        value: val,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  const merged: A2uiMetadata =
    Object.keys(mergedExtensions).length > 0 ? {extensions: mergedExtensions} : {};
  return cloneMetadata(merged);
}

/**
 * Validates, deep-clones, and deep-freezes an {@link A2uiMetadata} snapshot.
 *
 * @param metadata Metadata object to clone, or `undefined`.
 * @returns Deeply frozen clone of `metadata`, or `undefined`.
 */
export function cloneMetadata(metadata: A2uiMetadata | undefined): A2uiMetadata | undefined {
  if (metadata === undefined) return undefined;
  validateMetadata(metadata);
  if (!metadata.extensions || Object.keys(metadata.extensions).length === 0) {
    return undefined;
  }
  return cloneAndFreezeValue(metadata);
}

/** Compares two arrays for structural JSON equality. */
function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!jsonValueEquals(a[i], b[i])) return false;
  }
  return true;
}

/** Compares two plain objects for structural JSON equality. */
function objectsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a).filter(k => a[k] !== undefined);
  const keysB = Object.keys(b).filter(k => b[k] !== undefined);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!jsonValueEquals(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Compares two JSON-compatible values for deep structural equality.
 *
 * @param a First value.
 * @param b Second value.
 * @returns `true` if `a` and `b` are structurally equal.
 */
export function jsonValueEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return arraysEqual(a, b);
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    return objectsEqual(a, b);
  }
  return false;
}

/**
 * Compares two {@link A2uiMetadata} objects for deep structural equality.
 *
 * @param a First metadata snapshot.
 * @param b Second metadata snapshot.
 * @returns `true` if `a` and `b` have identical structure and values.
 */
export function metadataEquals(a: A2uiMetadata | undefined, b: A2uiMetadata | undefined): boolean {
  return jsonValueEquals(a, b);
}
