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
 * The allowlist rule of the web app frame protocol: an action, function call or data change is
 * processed only if its name is a key of the matching allowlist (`allowedEvents`,
 * `allowedFunctions`, `mutableData`) and, unless schema validation is disabled, its payload
 * matches the JSON Schema stored under that key.
 */

import Ajv, {type ValidateFunction} from 'ajv';
import {FORBIDDEN_PROTOTYPE_KEYS} from '../shared/sandbox/security.js';

/** Result of {@link PayloadValidator.checkAllowlist}. */
export type AllowlistDecision =
  | {readonly status: 'allowed'}
  | {readonly status: 'not-listed'}
  | {readonly status: 'invalid'; readonly errors: readonly string[]};

/** Options of {@link PayloadValidator.checkAllowlist}. */
export interface AllowlistOptions {
  /** Skips the schema validation; the name still has to be listed. */
  readonly disableSchemaValidation?: boolean;
}

function isSchemaObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/**
 * Validates payloads against JSON Schemas, compiling each schema once. Keep one instance per
 * bridge so the cache lives as long as the frame.
 */
export class PayloadValidator {
  private readonly ajv = new Ajv();
  private readonly cache = new Map<string, ValidateFunction>();

  /** Returns the validation errors of `payload` against `schema`, or an empty array if it matches. */
  validate(schema: object, payload: unknown): string[] {
    let validator: ValidateFunction;
    try {
      validator = this.compile(schema);
    } catch (error) {
      // A schema that does not compile cannot admit anything: fail closed.
      return [`Invalid schema: ${error instanceof Error ? error.message : String(error)}`];
    }
    if (validator(payload)) {
      return [];
    }
    return (validator.errors ?? []).map(error =>
      `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`.trim(),
    );
  }

  /**
   * Decides whether `name` with `payload` passes `allowlist`. Only own keys of the allowlist count,
   * so inherited names such as `constructor` are not listed. A key whose value is not an object
   * (for example `null`) lists the name without a schema.
   */
  checkAllowlist(
    name: string,
    payload: unknown,
    allowlist: Readonly<Record<string, unknown>> | undefined,
    options: AllowlistOptions = {},
  ): AllowlistDecision {
    if (!allowlist || !Object.hasOwn(allowlist, name)) {
      return {status: 'not-listed'};
    }
    const schema = allowlist[name];
    if (options.disableSchemaValidation || !isSchemaObject(schema)) {
      return {status: 'allowed'};
    }
    const errors = this.validate(schema, payload);
    return errors.length === 0 ? {status: 'allowed'} : {status: 'invalid', errors};
  }

  private compile(schema: object): ValidateFunction {
    const key = JSON.stringify(schema);
    let validator = this.cache.get(key);
    if (!validator) {
      validator = this.ajv.compile(schema);
      this.cache.set(key, validator);
    }
    return validator;
  }
}

function unescapePointerSegment(segment: string): string {
  return segment.replace(/~([01])/g, (_, c) => (c === '1' ? '/' : '~'));
}

/** Splits a relative JSON pointer into its reference tokens; a missing leading slash is tolerated. */
export function splitSubpath(subpath: string): string[] {
  if (subpath === '') {
    return [];
  }
  const pointer = subpath.startsWith('/') ? subpath.slice(1) : subpath;
  return pointer.split('/').map(unescapePointerSegment);
}

/**
 * Returns the value a bound key would hold after writing `value` at `subpath`, without touching
 * `root`, so the whole value can be validated against the key's schema before the write. Returns
 * `undefined` when the subpath contains a prototype pollution key, which is never written.
 */
export function projectSubpathChange(
  root: unknown,
  subpath: string,
  value: unknown,
): {readonly projected: unknown} | undefined {
  const segments = splitSubpath(subpath);
  if (segments.some(segment => FORBIDDEN_PROTOTYPE_KEYS.has(segment))) {
    return undefined;
  }
  if (segments.length === 0) {
    return {projected: value};
  }
  const projected: Record<string, unknown> =
    typeof root === 'object' && root !== null
      ? (structuredClone(root) as Record<string, unknown>)
      : {};
  let cursor = projected;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (typeof next !== 'object' || next === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
  return {projected};
}
