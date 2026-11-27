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

import {isPlainRecord} from './format_validators.js';

/**
 * Host-registered specification for an opaque / branded runtime value type
 * (such as `TrustedResourceUrl` or `SafeHtml`).
 *
 * Paired with `StringTypeDefinition.format` (e.g. `format: 'trusted-resource-url'`),
 * registering an `OpaqueTypeSpec` on a `Catalog` enforces strict chain-of-custody
 * validation: values passing `isInstance` are accepted and propagated intact through
 * `ComponentModel`, `DataModel`, `GenericBinder`, and `NodeResolver` (including
 * reactive `@path` bindings), while raw unbranded strings are rejected.
 */
export interface OpaqueTypeSpec<T = unknown> {
  /** Format / opaque type identifier matched against `StringTypeDefinition.format`. */
  readonly name: string;
  /** Runtime brand predicate verifying an authentic host value instance. */
  isInstance(value: unknown): value is T;
  /**
   * Optional serializer used when transmitting renderer state (`getRendererDataModel`)
   * or outbound `Action.context` payloads back to the agent.
   *
   * When omitted, matching opaque values are redacted (omitted from serialized
   * objects and arrays) so branded class instances never break JSON serialization
   * or leak private internals.
   */
  serializeForAgent?(value: T): unknown;
}

/** Read-only registry of host opaque value types keyed by format name. */
export type OpaqueTypeRegistry = ReadonlyMap<string, OpaqueTypeSpec>;

/** Internal sentinel marking a value that was redacted for agent transmission. */
const REDACTED_OPAQUE_VALUE = Symbol('a2ui.redactedOpaqueValue');

/**
 * Finds the first registered {@link OpaqueTypeSpec} whose `isInstance` predicate
 * matches `value`, if any.
 */
export function findMatchingOpaqueSpec(
  value: unknown,
  opaqueTypes: OpaqueTypeRegistry | undefined,
): OpaqueTypeSpec | undefined {
  if (!opaqueTypes || opaqueTypes.size === 0 || value === null || value === undefined) {
    return undefined;
  }
  for (const spec of opaqueTypes.values()) {
    if (spec.isInstance(value)) {
      return spec;
    }
  }
  return undefined;
}

/**
 * Collects all opaque type registrations across a set of catalogs into a single
 * lookup map, or returns `undefined` when no catalog registers any opaque types.
 */
export function mergeOpaqueTypeRegistries(
  catalogs: Iterable<{readonly opaqueTypes?: OpaqueTypeRegistry} | undefined>,
): OpaqueTypeRegistry | undefined {
  let merged: Map<string, OpaqueTypeSpec> | undefined;
  for (const catalog of catalogs) {
    const registry = catalog?.opaqueTypes;
    if (!registry || registry.size === 0) continue;
    if (!merged) {
      merged = new Map();
    }
    for (const [key, spec] of registry) {
      if (!merged.has(key)) {
        merged.set(key, spec);
      }
    }
  }
  return merged;
}

function serializeValueInner(value: unknown, opaqueTypes: OpaqueTypeRegistry): unknown {
  const matched = findMatchingOpaqueSpec(value, opaqueTypes);
  if (matched) {
    if (!matched.serializeForAgent) {
      return REDACTED_OPAQUE_VALUE;
    }
    const serialized = matched.serializeForAgent(value);
    return serialized === undefined ? REDACTED_OPAQUE_VALUE : serialized;
  }

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const next = serializeValueInner(item, opaqueTypes);
      if (next !== REDACTED_OPAQUE_VALUE) {
        out.push(next);
      }
    }
    return out;
  }

  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const next = serializeValueInner(v, opaqueTypes);
      if (next !== REDACTED_OPAQUE_VALUE) {
        Object.defineProperty(out, k, {
          value: next,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    return out;
  }

  return value;
}

/**
 * Recursively transforms a renderer value (such as a surface data model or
 * outbound `Action.context`) for transmission to an agent, applying
 * {@link OpaqueTypeSpec.serializeForAgent} to any registered opaque value and
 * redacting (omitting) opaque values that declare no serializer.
 *
 * Returns `value` unchanged when `opaqueTypes` is absent or empty.
 */
export function serializeOpaqueValuesForAgent(
  value: unknown,
  opaqueTypes: OpaqueTypeRegistry | undefined,
): unknown {
  if (!opaqueTypes || opaqueTypes.size === 0) {
    return value;
  }
  const result = serializeValueInner(value, opaqueTypes);
  return result === REDACTED_OPAQUE_VALUE ? undefined : result;
}
