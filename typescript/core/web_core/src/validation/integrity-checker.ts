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

import {A2uiRecursionError, A2uiValidationError} from '../errors.js';
import {Catalog, type ComponentApi} from '../catalog/types.js';
import {isAtLeastVersion} from '../common/semver.js';
import {ProtocolVersion} from '../processing/adapters/base.js';

/** Maximum permitted nesting depth for JSON objects and array structures. */
export const MAX_GLOBAL_DEPTH = 50;

/** Maximum permitted recursion depth for nested function calls. */
export const MAX_FUNC_CALL_DEPTH = 5;

/** Regex pattern matching valid JSON Pointer syntax (RFC 6901 compliant with optional relative path). */
export const RELAXED_PATH_PATTERN =
  /^(?:(?:\/(?:[^~/]|~[01])*)*|(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])*)*)$/;

import {
  analyzeChildRefSchema,
  buildComponentRefMap,
  ChildRefAnalysis,
  ChildRefAnalysisOptions,
  ComponentChildRefs,
  ComponentRefMap,
  isChildListSchema,
  isChildOrChildListSchema,
  isChildSchema,
} from '../catalog/reference-map.js';
import {V08_CHILD_REF_OPTIONS} from '../v0_8/standard_defs.js';
import {V09_CHILD_REF_OPTIONS} from '../v0_9/standard_defs.js';
import {V10_CHILD_REF_OPTIONS} from '../v1_0/standard_defs.js';

import {isValidUax31Identifier, assertUax31Identifier} from '../common/uax31.js';

export type {ChildRefAnalysis, ChildRefAnalysisOptions, ComponentChildRefs, ComponentRefMap};
export {
  analyzeChildRefSchema,
  assertUax31Identifier,
  buildComponentRefMap,
  isChildListSchema,
  isChildOrChildListSchema,
  isChildSchema,
  isValidUax31Identifier,
  V08_CHILD_REF_OPTIONS,
  V09_CHILD_REF_OPTIONS,
  V10_CHILD_REF_OPTIONS,
};

/**
 * Yields `[referencedId, path]` pairs for every child reference reachable from a
 * property value.
 *
 * @param val The property value to walk.
 * @param currentPath The property path accumulated so far.
 * @param nestedKeys Item sub-keys the catalog declared as child references, for
 *   a list property whose items are structured objects. When omitted, every
 *   sub-key of such an item is walked.
 */
function* extractPointers(
  val: unknown,
  currentPath: string,
  nestedKeys?: ReadonlySet<string>,
  inArray = false,
  isAtLeastV10 = false,
): Generator<[string, string]> {
  if (typeof val === 'string') {
    yield [val, currentPath];
  } else if (Array.isArray(val)) {
    for (let idx = 0; idx < val.length; idx++) {
      const item = val[idx];
      const subPath = `${currentPath}[${idx}]`;
      yield* extractPointers(item, subPath, nestedKeys, true, isAtLeastV10);
    }
  } else if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>;
    if (
      isAtLeastV10 &&
      (Object.hasOwn(obj, '@child') ||
        Object.hasOwn(obj, '@action') ||
        Object.hasOwn(obj, '@functionCall'))
    ) {
      return;
    }
    const isTemplate =
      Object.hasOwn(obj, 'componentId') &&
      typeof obj['componentId'] === 'string' &&
      (Object.hasOwn(obj, 'path') ||
        Object.hasOwn(obj, '@path') ||
        Object.hasOwn(obj, 'dataBinding'));
    const isV08ListWrapper =
      !inArray &&
      (Array.isArray(obj['explicitList']) ||
        (typeof obj['template'] === 'object' && obj['template'] !== null));
    if (
      nestedKeys?.size &&
      (inArray ||
        (!isTemplate && !isV08ListWrapper) ||
        Array.from(nestedKeys).some(subKey => Object.hasOwn(obj, subKey)))
    ) {
      // The catalog declared exactly which sub-keys carry a child, so sibling
      // properties such as a tab title are not references.
      for (const subKey of nestedKeys) {
        if (Object.hasOwn(obj, subKey)) {
          yield* extractPointers(
            obj[subKey],
            `${currentPath}.${subKey}`,
            undefined,
            false,
            isAtLeastV10,
          );
        }
      }
    } else if (isTemplate) {
      yield [obj['componentId'] as string, `${currentPath}.componentId`];
    } else if (
      Object.hasOwn(obj, 'path') ||
      Object.hasOwn(obj, '@path') ||
      Object.hasOwn(obj, 'call') ||
      Object.hasOwn(obj, '@call')
    ) {
      return;
    } else {
      for (const [subKey, subVal] of Object.entries(obj)) {
        yield* extractPointers(subVal, `${currentPath}.${subKey}`, undefined, false, isAtLeastV10);
      }
    }
  }
}

function getOrCreateRefMap(catalog: Catalog<ComponentApi>): ComponentRefMap {
  return catalog.componentRefMap;
}

const SKIP_AT_CHILD_DIRECTIVE_KEYS = new Set([
  '@path',
  '@call',
  '@action',
  '@functionCall',
  '@metadata',
  '@catalogId',
  '@accessibility',
  '@checks',
]);

function* extractAtChildPointers(
  val: unknown,
  currentPath: string,
  skipTopLevelEnvelopeKeys = false,
): Generator<[string, string]> {
  if (Array.isArray(val)) {
    for (let idx = 0; idx < val.length; idx++) {
      const subPath = currentPath ? `${currentPath}/${idx}` : String(idx);
      yield* extractAtChildPointers(val[idx], subPath);
    }
    return;
  }

  if (typeof val !== 'object' || val === null) {
    return;
  }

  const obj = val as Record<string, unknown>;
  if (Object.hasOwn(obj, '@child')) {
    const childVal = obj['@child'];
    if (typeof childVal === 'string' && childVal.length > 0) {
      if (Object.hasOwn(obj, '@path')) {
        yield [childVal, currentPath ? `${currentPath}/@child` : '@child'];
      } else {
        yield [childVal, currentPath];
      }
    } else if (Array.isArray(childVal)) {
      for (let idx = 0; idx < childVal.length; idx++) {
        const entry = childVal[idx];
        if (typeof entry === 'string' && entry.length > 0) {
          yield [entry, currentPath ? `${currentPath}/${idx}` : String(idx)];
        }
      }
    }
    return;
  }

  if (
    Object.hasOwn(obj, '@path') ||
    Object.hasOwn(obj, '@call') ||
    Object.hasOwn(obj, '@action') ||
    Object.hasOwn(obj, '@functionCall')
  ) {
    return;
  }

  for (const [subKey, subVal] of Object.entries(obj)) {
    if (subKey.startsWith('@@') || SKIP_AT_CHILD_DIRECTIVE_KEYS.has(subKey)) {
      continue;
    }
    if (
      skipTopLevelEnvelopeKeys &&
      (subKey === 'id' ||
        subKey === 'component' ||
        subKey === 'metadata' ||
        subKey === 'catalogId' ||
        subKey === 'accessibility' ||
        subKey === 'checks')
    ) {
      continue;
    }
    const nextPath = currentPath ? `${currentPath}/${subKey}` : subKey;
    yield* extractAtChildPointers(subVal, nextPath);
  }
}

/**
 * Extracts child component IDs referenced by a component property definition.
 *
 * @param component Component definition object containing properties and metadata.
 * @param catalogOrRefMap Mapping defining single and list reference fields per component type or Catalog instance.
 * @param protocolVersion Optional protocol version controlling v1.0 schema-less `@child` extraction.
 * @yields Tuple of `[referencedId, propertyPath]` for each child reference found.
 *
 * @example
 * ```ts
 * const refs = Array.from(getComponentReferences(boxComponent, catalog));
 * ```
 */
export function* getComponentReferences(
  component: Record<string, unknown>,
  catalogOrRefMap: Catalog<ComponentApi> | ComponentRefMap,
  protocolVersion?: string,
): Generator<[string, string]> {
  if (!component || typeof component !== 'object') {
    return;
  }
  const refFieldsMap: ComponentRefMap =
    catalogOrRefMap instanceof Catalog ? getOrCreateRefMap(catalogOrRefMap) : catalogOrRefMap;

  const compVal = component.component;
  let compType = '';
  let props: Record<string, unknown> = component;

  if (typeof compVal === 'string') {
    compType = compVal;
  } else if (typeof compVal === 'object' && compVal !== null) {
    const compObj = compVal as Record<string, unknown>;
    compType = Object.keys(compObj)[0] ?? '';
    props = (compObj[compType] as Record<string, unknown>) ?? {};
  }

  if (!compType || typeof props !== 'object' || props === null) {
    return;
  }

  const effectiveVersion =
    protocolVersion ??
    (catalogOrRefMap instanceof Catalog ? catalogOrRefMap.protocolVersion : undefined);
  const isAtLeastV10 =
    effectiveVersion !== undefined ? isAtLeastVersion(effectiveVersion, '1.0') : false;

  if (isAtLeastV10) {
    yield* extractAtChildPointers(props, '', props === component);
  }

  const childRefs = refFieldsMap[compType];
  const singleRefs = childRefs ? childRefs.singleRefs : new Set<string>();
  const listRefs = childRefs ? childRefs.listRefs : new Set<string>();
  const nestedRefs = childRefs?.nestedRefs;

  // TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
  for (const [key, value] of Object.entries(props)) {
    if (singleRefs.has(key) || listRefs.has(key)) {
      yield* extractPointers(value, key, nestedRefs?.[key], false, isAtLeastV10);
    }
  }
}

/** Configuration options for component topology and hierarchy analysis. */
export interface TopologyOptions {
  /** Expected root component identifier. Defaults to 'root'. */
  rootId?: string;
  /** Whether to permit references to non-existent component identifiers. */
  allowDanglingReferences?: boolean;
  /** Whether to allow components that are not reachable from the root node. */
  allowOrphanComponents?: boolean;
  /** Whether to allow a component tree that does not contain a root component. */
  allowMissingRoot?: boolean;
  /** Maximum permitted global graph traversal depth. Defaults to 50. */
  maxDepth?: number;
}

/** Combined configuration specifying topology, version, and catalog validation rules. */
export interface ValidationConfig extends TopologyOptions {
  /** Target protocol version expected for incoming messages (e.g. 'v0.8', 'v0.9', 'v1.0'). */
  targetVersion?: ProtocolVersion | string;
  /**
   * Whether to allow components and functions that the resolved catalog does
   * not define. Defaults to false.
   *
   * A renderer that uses agent-side functions must either set this to `true`
   * or declare those functions, without implementations, in the catalog the
   * calls resolve to. Otherwise validation rejects the calls before they can
   * be routed to the agent with `callAgentFunction`.
   */
  allowUnknownElements?: boolean;
  /** Allowed top-level message operation types (e.g. ['createSurface', 'updateComponents']). */
  allowedMessages?: string[];
}

/** Strict validation configuration requiring root node presence, no orphans, valid references, and catalog compliance. */
export const STRICT_VALIDATION: ValidationConfig = Object.freeze({
  allowOrphanComponents: false,
  allowDanglingReferences: false,
  allowMissingRoot: false,
  allowUnknownElements: false,
});

/** Relaxed validation configuration permitting orphan components, missing root, dangling references, and unknown elements. */
export const RELAXED_VALIDATION: ValidationConfig = Object.freeze({
  allowOrphanComponents: true,
  allowDanglingReferences: true,
  allowMissingRoot: true,
  allowUnknownElements: true,
});

function traverseRecursionAndPaths(item: unknown, globalDepth: number, funcDepth: number): void {
  if (globalDepth > MAX_GLOBAL_DEPTH) {
    throw new A2uiRecursionError(`Global recursion limit exceeded: Depth > ${MAX_GLOBAL_DEPTH}`);
  }

  if (Array.isArray(item)) {
    for (const x of item) {
      traverseRecursionAndPaths(x, globalDepth + 1, funcDepth);
    }
    return;
  }

  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    // v1.0 binds data with `@path`; earlier versions and templates use `path`.
    for (const path of [obj.path, obj['@path']]) {
      if (typeof path === 'string' && !RELAXED_PATH_PATTERN.test(path)) {
        throw new A2uiValidationError(`Invalid path syntax: '${path}'`);
      }
    }

    const isFunctionCallWrapper =
      (Object.hasOwn(obj, '@functionCall') &&
        typeof obj['@functionCall'] === 'object' &&
        obj['@functionCall'] !== null) ||
      (Object.hasOwn(obj, 'functionCall') &&
        typeof obj.functionCall === 'object' &&
        obj.functionCall !== null);
    const isBareFunctionCall =
      (Object.hasOwn(obj, 'call') || Object.hasOwn(obj, '@call')) && Object.hasOwn(obj, 'args');

    if (isFunctionCallWrapper) {
      if (funcDepth >= MAX_FUNC_CALL_DEPTH) {
        throw new A2uiRecursionError(
          `Recursion limit exceeded: functionCall depth > ${MAX_FUNC_CALL_DEPTH}`,
        );
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'functionCall' || k === '@functionCall') {
          traverseRecursionAndPaths(v, globalDepth + 1, funcDepth + 1);
        } else {
          traverseRecursionAndPaths(v, globalDepth + 1, funcDepth);
        }
      }
    } else if (isBareFunctionCall) {
      if (funcDepth >= MAX_FUNC_CALL_DEPTH) {
        throw new A2uiRecursionError(
          `Recursion limit exceeded: functionCall depth > ${MAX_FUNC_CALL_DEPTH}`,
        );
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'args') {
          traverseRecursionAndPaths(v, globalDepth + 1, funcDepth + 1);
        } else {
          traverseRecursionAndPaths(v, globalDepth + 1, funcDepth);
        }
      }
    } else {
      for (const v of Object.values(obj)) {
        traverseRecursionAndPaths(v, globalDepth + 1, funcDepth);
      }
    }
  }
}

/**
 * Traverses a JSON data payload to validate path syntax and recursion limits.
 *
 * @param data Data payload or component hierarchy to evaluate.
 * @throws {A2uiRecursionError} If global structure depth or function call depth exceeds limits.
 * @throws {A2uiValidationError} If an invalid JSON Pointer path format is encountered.
 */
export function validateRecursionAndPaths(data: unknown): void {
  traverseRecursionAndPaths(data, 0, 0);
}
