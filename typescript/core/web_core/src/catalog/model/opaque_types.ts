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

import {A2uiValidationError} from '../../errors.js';

function isPlainLiteralObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Maximum nesting depth allowed when sanitizing opaque values for outbound transmission. */
export const MAX_OPAQUE_SERIALIZE_DEPTH = 64;

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
 * Resolves the strict opaque type specs governing a dynamic string property slot.
 *
 * Returns a non-empty list of matching {@link OpaqueTypeSpec}s only when at least
 * one declared format is registered in `opaqueTypes` AND no unregistered string
 * formats remain (matching `validateCatalogValue` semantics). Otherwise returns
 * `undefined` so plain string formats (such as `'uri'` or `'email'`) pass through.
 */
export function resolveStrictOpaqueSpecs(
  formats: readonly string[] | undefined,
  opaqueTypes: OpaqueTypeRegistry | undefined,
): readonly OpaqueTypeSpec[] | undefined {
  if (!formats || formats.length === 0 || !opaqueTypes || opaqueTypes.size === 0) {
    return undefined;
  }
  const matched: OpaqueTypeSpec[] = [];
  for (const fmt of formats) {
    const spec = opaqueTypes.get(fmt);
    if (!spec) {
      return undefined;
    }
    matched.push(spec);
  }
  return matched.length > 0 ? matched : undefined;
}

function combineOpaqueSpecs(key: string, specs: readonly OpaqueTypeSpec[]): OpaqueTypeSpec {
  const unique: OpaqueTypeSpec[] = [];
  for (const spec of specs) {
    if (!unique.includes(spec)) {
      unique.push(spec);
    }
  }
  if (unique.length === 1) {
    return unique[0];
  }
  return {
    name: key,
    isInstance(value: unknown): value is unknown {
      return unique.some(s => s.isInstance(value));
    },
    serializeForAgent(value: unknown): unknown {
      for (const spec of unique) {
        if (spec.isInstance(value)) {
          return spec.serializeForAgent ? spec.serializeForAgent(value) : undefined;
        }
      }
      return undefined;
    },
  };
}

/**
 * Collects all opaque type registrations across a set of catalogs into a single
 * lookup map, or returns `undefined` when no catalog registers any opaque types.
 *
 * When multiple catalogs register distinct specs under the same format name,
 * their predicates and serializers are composed so no catalog's opaque instances
 * are silently dropped or leaked during outbound sanitization.
 */
export function mergeOpaqueTypeRegistries(
  catalogs: Iterable<{readonly opaqueTypes?: OpaqueTypeRegistry} | undefined>,
): OpaqueTypeRegistry | undefined {
  let grouped: Map<string, OpaqueTypeSpec[]> | undefined;
  for (const catalog of catalogs) {
    const registry = catalog?.opaqueTypes;
    if (!registry || registry.size === 0) continue;
    if (!grouped) {
      grouped = new Map();
    }
    for (const [key, spec] of registry) {
      let list = grouped.get(key);
      if (!list) {
        list = [];
        grouped.set(key, list);
      }
      if (!list.includes(spec)) {
        list.push(spec);
      }
    }
  }
  if (!grouped) return undefined;
  const merged = new Map<string, OpaqueTypeSpec>();
  for (const [key, specs] of grouped) {
    merged.set(key, combineOpaqueSpecs(key, specs));
  }
  return merged;
}

function serializeValueInner(
  value: unknown,
  opaqueTypes: OpaqueTypeRegistry,
  seen: Set<object>,
  depth: number,
): unknown {
  if (depth > MAX_OPAQUE_SERIALIZE_DEPTH) {
    throw new A2uiValidationError(
      `Opaque value serialization exceeded maximum depth (${MAX_OPAQUE_SERIALIZE_DEPTH}).`,
    );
  }

  const matched = findMatchingOpaqueSpec(value, opaqueTypes);
  if (matched) {
    if (!matched.serializeForAgent) {
      return REDACTED_OPAQUE_VALUE;
    }
    const isObj = typeof value === 'object' && value !== null;
    if (isObj) {
      if (seen.has(value as object)) {
        throw new A2uiValidationError('Cannot serialize cyclic value for agent transmission.');
      }
      seen.add(value as object);
    }
    try {
      const serialized = matched.serializeForAgent(value);
      if (serialized === undefined) {
        return REDACTED_OPAQUE_VALUE;
      }
      return serializeValueInner(serialized, opaqueTypes, seen, depth + 1);
    } finally {
      if (isObj) {
        seen.delete(value as object);
      }
    }
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new A2uiValidationError('Cannot serialize cyclic value for agent transmission.');
    }
    seen.add(value);
    try {
      const out: unknown[] = [];
      for (const item of value) {
        const next = serializeValueInner(item, opaqueTypes, seen, depth + 1);
        if (next !== REDACTED_OPAQUE_VALUE) {
          out.push(next);
        }
      }
      return out;
    } finally {
      seen.delete(value);
    }
  }

  if (isPlainLiteralObject(value)) {
    if (seen.has(value)) {
      throw new A2uiValidationError('Cannot serialize cyclic value for agent transmission.');
    }
    seen.add(value);
    try {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        const next = serializeValueInner(v, opaqueTypes, seen, depth + 1);
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
    } finally {
      seen.delete(value);
    }
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
  const result = serializeValueInner(value, opaqueTypes, new Set<object>(), 0);
  return result === REDACTED_OPAQUE_VALUE ? undefined : result;
}
