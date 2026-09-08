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

export type {ChildRefAnalysis, ChildRefAnalysisOptions, ComponentChildRefs, ComponentRefMap};
export {
  analyzeChildRefSchema,
  buildComponentRefMap,
  isChildListSchema,
  isChildOrChildListSchema,
  isChildSchema,
  V08_CHILD_REF_OPTIONS,
  V09_CHILD_REF_OPTIONS,
  V10_CHILD_REF_OPTIONS,
};

function* extractPointers(val: unknown, currentPath: string): Generator<[string, string]> {
  if (typeof val === 'string') {
    yield [val, currentPath];
  } else if (Array.isArray(val)) {
    for (let idx = 0; idx < val.length; idx++) {
      const item = val[idx];
      const subPath = `${currentPath}[${idx}]`;
      yield* extractPointers(item, subPath);
    }
  } else if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>;
    if ('componentId' in obj && typeof obj.componentId === 'string' && 'path' in obj) {
      yield [obj.componentId, `${currentPath}.componentId`];
    } else if ('child' in obj && typeof obj.child === 'string') {
      yield [obj.child, `${currentPath}.child`];
    } else {
      for (const [subKey, subVal] of Object.entries(obj)) {
        yield* extractPointers(subVal, `${currentPath}.${subKey}`);
      }
    }
  }
}

function getOrCreateRefMap(catalog: Catalog<ComponentApi>): ComponentRefMap {
  return catalog.componentRefMap;
}

/**
 * Extracts child component IDs referenced by a component property definition.
 *
 * @param component Component definition object containing properties and metadata.
 * @param catalogOrRefMap Mapping defining single and list reference fields per component type or Catalog instance.
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

  const childRefs = refFieldsMap[compType];
  const singleRefs = childRefs ? childRefs.singleRefs : new Set<string>();
  const listRefs = childRefs ? childRefs.listRefs : new Set<string>();

  for (const [key, value] of Object.entries(props)) {
    if (singleRefs.has(key) || listRefs.has(key)) {
      yield* extractPointers(value, key);
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
  /** Whether to allow component types that do not exist in the surface catalog. Defaults to false. */
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
    if ('path' in obj && typeof obj.path === 'string') {
      const path = obj.path;
      if (!RELAXED_PATH_PATTERN.test(path)) {
        throw new A2uiValidationError(`Invalid path syntax: '${path}'`);
      }
    }

    const isFunctionCallWrapper =
      'functionCall' in obj && typeof obj.functionCall === 'object' && obj.functionCall !== null;
    const isBareFunctionCall = 'call' in obj && 'args' in obj;

    if (isFunctionCallWrapper) {
      if (funcDepth >= MAX_FUNC_CALL_DEPTH) {
        throw new A2uiRecursionError(
          `Recursion limit exceeded: functionCall depth > ${MAX_FUNC_CALL_DEPTH}`,
        );
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'functionCall') {
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
