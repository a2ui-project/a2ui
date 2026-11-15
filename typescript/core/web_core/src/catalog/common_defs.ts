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

/**
 * @fileoverview The common types definitions of each protocol version, and
 * what a function's argument schema requires, for the catalog serializers.
 *
 * This module is internal to web_core and is not re-exported by any facade.
 */

import {isAtLeastVersion, normalizeVersionString, toCanonicalVersion} from '../common/semver.js';
import {V08_STANDARD_DEFS} from '../v0_8/standard_defs.js';
import {V09_STANDARD_DEFS} from '../v0_9/standard_defs.js';
import {V10_STANDARD_DEFS} from '../v1_0/standard_defs.js';

type JsonObject = Record<string, unknown>;

/** The reference a common types document is written as when a catalog names none. */
export const DEFAULT_COMMON_TYPES_URI = 'common_types.json';

const STANDARD_DEFS_BY_VERSION: Readonly<Record<string, Record<string, unknown>>> = {
  '0.8': V08_STANDARD_DEFS,
  '0.9': V09_STANDARD_DEFS,
  '0.9.1': V09_STANDARD_DEFS,
  '1.0': V10_STANDARD_DEFS,
};

/**
 * Returns the common types definitions of a protocol version. A version with
 * no entry of its own at or above 1.0 gets the v1.0 definitions, and any other
 * version the v0.9 definitions.
 *
 * @param version A protocol version.
 */
export function standardDefsForVersion(version: string | undefined): Record<string, unknown> {
  if (version) {
    const key = toCanonicalVersion(version) ?? normalizeVersionString(version);
    if (key in STANDARD_DEFS_BY_VERSION) return STANDARD_DEFS_BY_VERSION[key];
    if (isAtLeastVersion(version, '1.0')) return V10_STANDARD_DEFS;
  }
  return V09_STANDARD_DEFS;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns whether a function's argument JSON Schema requires `args` to be
 * supplied on a call to the function: that is, whether an omitted (empty)
 * argument object cannot satisfy the schema.
 *
 * A schema requires arguments when it directly declares `required` properties
 * or a positive `minProperties`, when any member of an `allOf` requires
 * arguments, when every branch of a non-empty `oneOf` or `anyOf` union
 * requires arguments, or when a local `#/$defs/...` `$ref` resolves in `defs`
 * to a schema that requires arguments. A schema that carries a `default`
 * value does not require arguments.
 *
 * @param schema The function's `args` JSON Schema.
 * @param defs Optional `$defs` map for resolving local `#/$defs/...` references.
 * @param visited References already on the resolution stack.
 */
export function schemaRequiresArgs(
  schema: unknown,
  defs?: Readonly<Record<string, unknown>>,
  visited: ReadonlySet<string> = new Set(),
): boolean {
  if (!isObject(schema) || schema['default'] !== undefined) return false;
  if (Array.isArray(schema['required']) && schema['required'].length > 0) return true;
  if (typeof schema['minProperties'] === 'number' && schema['minProperties'] > 0) return true;
  const ref = schema['$ref'];
  if (typeof ref === 'string' && defs && ref.startsWith('#/$defs/') && !visited.has(ref)) {
    let target: unknown = defs;
    for (const raw of ref.slice('#/$defs/'.length).split('/')) {
      const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      target = isObject(target) && Object.hasOwn(target, segment) ? target[segment] : undefined;
    }
    if (target !== undefined && schemaRequiresArgs(target, defs, new Set(visited).add(ref))) {
      return true;
    }
  }
  if (
    Array.isArray(schema['allOf']) &&
    schema['allOf'].some(sub => schemaRequiresArgs(sub, defs, visited))
  ) {
    return true;
  }
  if (
    Array.isArray(schema['oneOf']) &&
    schema['oneOf'].length > 0 &&
    schema['oneOf'].every(sub => schemaRequiresArgs(sub, defs, visited))
  ) {
    return true;
  }
  if (
    Array.isArray(schema['anyOf']) &&
    schema['anyOf'].length > 0 &&
    schema['anyOf'].every(sub => schemaRequiresArgs(sub, defs, visited))
  ) {
    return true;
  }
  return false;
}
