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

import {A2uiIntegrityError, A2uiRecursionError, A2uiValidationError} from '../errors.js';
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

/** Configuration options for component integrity validation. */
export interface IntegrityOptions {
  /** Expected identifier for the root component in the hierarchy. Defaults to 'root'. */
  rootId?: string;
  /** Whether to permit references to non-existent component identifiers. */
  allowDanglingReferences?: boolean;
  /** Whether to allow a component tree that does not contain a root component. */
  allowMissingRoot?: boolean;
}

/** Configuration options for component topology and hierarchy analysis. */
export interface TopologyOptions {
  /** Expected root component identifier. Defaults to 'root'. */
  rootId?: string;
  /** Whether to allow components that are not reachable from the root node. */
  allowOrphanComponents?: boolean;
  /** Whether to perform analysis when the root component is absent. */
  allowMissingRoot?: boolean;
  /** Maximum permitted global graph traversal depth. Defaults to 50. */
  maxDepth?: number;
}

/** Combined configuration specifying integrity, topology, version, and catalog validation rules. */
export interface ValidationConfig extends IntegrityOptions, TopologyOptions {
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

/** Catalog, reference map, or collection of catalogs providing child reference definitions. */
export type CatalogOrRefMapInput =
  | Catalog<ComponentApi>
  | ComponentRefMap
  | Array<Catalog<ComponentApi>>
  | Map<string, Catalog<ComponentApi>>;

function resolveRefMapForComponent(
  comp: Record<string, unknown>,
  catalogInput: CatalogOrRefMapInput,
): ComponentRefMap {
  if (catalogInput instanceof Catalog) {
    return getOrCreateRefMap(catalogInput);
  }
  if (Array.isArray(catalogInput)) {
    const rawCatalogId = comp.catalogId ?? comp.catalogID;
    if (typeof rawCatalogId === 'string' && rawCatalogId) {
      const found = catalogInput.find(c => c.id === rawCatalogId);
      if (found) return getOrCreateRefMap(found);
      return {};
    }
    if (catalogInput.length > 0 && catalogInput[0] instanceof Catalog) {
      return getOrCreateRefMap(catalogInput[0]);
    }
    return {};
  }
  if (catalogInput instanceof Map) {
    const rawCatalogId = comp.catalogId ?? comp.catalogID;
    if (typeof rawCatalogId === 'string' && rawCatalogId) {
      const cat = catalogInput.get(rawCatalogId);
      if (cat) return getOrCreateRefMap(cat);
      return {};
    }
    const first = catalogInput.values().next().value;
    if (first instanceof Catalog) {
      return getOrCreateRefMap(first);
    }
    return {};
  }
  return catalogInput as ComponentRefMap;
}

/**
 * Validates the structural integrity of a list of component definitions.
 *
 * @param components Array of component definition objects to audit.
 * @param catalogOrRefMap Component reference field mapping definitions, Catalog instance, or list/map of Catalogs.
 * @param options Integrity configuration options.
 * @throws {A2uiIntegrityError} If duplicate IDs, missing root, or dangling references are found.
 *
 * @example
 * ```ts
 * validateComponentIntegrity(components, catalog, { rootId: 'root' });
 * ```
 */
export function validateComponentIntegrity(
  components: Array<Record<string, unknown>>,
  catalogOrRefMap: CatalogOrRefMapInput,
  options: IntegrityOptions = {},
): void {
  const rootId = options.rootId ?? 'root';
  const allowDanglingReferences = options.allowDanglingReferences ?? false;
  const allowMissingRoot = options.allowMissingRoot ?? false;

  const ids = new Set<string>();

  // 1. Collect IDs and check for duplicates
  for (const comp of components) {
    if (!comp || typeof comp !== 'object') continue;
    const compId = comp.id;
    if (compId === undefined || compId === null || compId === '') {
      throw new A2uiIntegrityError('Component is missing a valid id.');
    }
    const compIdStr = String(compId);
    if (ids.has(compIdStr)) {
      throw new A2uiIntegrityError(`Duplicate component ID: ${compIdStr}`);
    }
    ids.add(compIdStr);
  }

  // 2. Check for root component
  if (!allowMissingRoot && !ids.has(rootId)) {
    throw new A2uiIntegrityError(`Missing root component: No component has id='${rootId}'`);
  }

  if (allowDanglingReferences) {
    return;
  }

  // 3. Check for dangling references
  for (const comp of components) {
    if (!comp || typeof comp !== 'object') continue;
    const compId = comp.id !== undefined && comp.id !== null ? String(comp.id) : 'Unknown';
    const refFieldsMap = resolveRefMapForComponent(comp, catalogOrRefMap);
    for (const [refId, fieldName] of getComponentReferences(comp, refFieldsMap)) {
      if (!ids.has(refId)) {
        throw new A2uiIntegrityError(
          `Component '${compId}' references non-existent component '${refId}' in field '${fieldName}'`,
        );
      }
    }
  }
}

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
