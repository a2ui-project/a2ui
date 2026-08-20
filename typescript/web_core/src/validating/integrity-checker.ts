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
import {Catalog, ComponentApi} from '../catalog/types.js';

/** Maximum permitted nesting depth for JSON objects and array structures. */
export const MAX_GLOBAL_DEPTH = 50;

/** Maximum permitted recursion depth for nested function calls. */
export const MAX_FUNC_CALL_DEPTH = 5;

/** Regex pattern matching valid JSON Pointer syntax (RFC 6901 compliant with optional relative path). */
export const RELAXED_PATH_PATTERN =
  /^(?:(?:\/(?:[^~/]|~[01])*)*|(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])*)*)$/;

/** Map of component type names to sets of single and list child reference property names. */
export type ComponentRefMap = Record<string, [Set<string>, Set<string>]>;

/** Default component reference map for standard basic catalog component types. */
export const STANDARD_REF_MAP: ComponentRefMap = {
  'Column': [new Set(), new Set(['children'])],
  'Row': [new Set(), new Set(['children'])],
  'Card': [new Set(['child']), new Set()],
  'Box': [new Set(['child']), new Set()],
  'List': [new Set(), new Set(['children'])],
  'Tabs': [new Set(), new Set(['tabs'])],
  'Modal': [new Set(['trigger', 'content']), new Set()],
  'Button': [new Set(['child']), new Set()],
  'Container': [new Set(['singleChild', 'nestedObj']), new Set(['childrenList', 'tabs'])],
  'Node': [new Set(['next', 'child']), new Set(['children'])],
};

function isChildRefSchema(schema: any, keyName?: string): boolean {
  if (!schema || typeof schema !== 'object') return false;
  let current = schema;
  while (current?._def) {
    const typeName = current._def.typeName;
    if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
      current = current._def.innerType;
    } else if (typeName === 'ZodEffects') {
      current = current._def.schema;
    } else {
      break;
    }
  }

  const desc: string = current?.description ?? current?._def?.description ?? '';
  if (desc.includes('ChildList') || desc.includes('ComponentId') || desc.includes('Child')) {
    return true;
  }

  if (
    keyName &&
    (keyName === 'child' ||
      keyName === 'children' ||
      keyName === 'trigger' ||
      keyName === 'content' ||
      keyName.endsWith('Child') ||
      keyName === 'root')
  ) {
    return true;
  }

  if (current?._def?.typeName === 'ZodUnion') {
    const options = (current._def.options as any[]) ?? [];
    const hasTemplate = options.some(
      o =>
        o?._def?.typeName === 'ZodObject' &&
        typeof o._def.shape === 'function' &&
        o._def.shape().componentId &&
        o._def.shape().path,
    );
    if (hasTemplate) return true;
  }

  return false;
}

/**
 * Builds a ComponentRefMap dynamically by inspecting component Zod schemas.
 *
 * @param catalogOrComponents Catalog instance, array of ComponentApi objects, or Map of ComponentApis.
 * @returns ComponentRefMap containing single and list reference properties.
 */
export function buildComponentRefMap(
  catalogOrComponents: Catalog<any> | ComponentApi[] | Map<string, ComponentApi>,
): ComponentRefMap {
  const refMap: ComponentRefMap = {};
  const componentApis: ComponentApi[] =
    catalogOrComponents instanceof Catalog
      ? Array.from(catalogOrComponents.components.values())
      : Array.isArray(catalogOrComponents)
        ? catalogOrComponents
        : Array.from(catalogOrComponents.values());

  for (const compApi of componentApis) {
    const singleRefs = new Set<string>();
    const listRefs = new Set<string>();

    if (compApi.schema) {
      let current: any = compApi.schema;
      while (current?._def) {
        const typeName = current._def.typeName;
        if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
          current = current._def.innerType;
        } else if (typeName === 'ZodEffects') {
          current = current._def.schema;
        } else {
          break;
        }
      }

      if (current?._def?.typeName === 'ZodObject' && typeof current._def.shape === 'function') {
        const shape = current._def.shape();
        for (const [key, fieldSchema] of Object.entries(shape)) {
          let inner: any = fieldSchema;
          while (inner?._def) {
            const tn = inner._def.typeName;
            if (tn === 'ZodOptional' || tn === 'ZodNullable' || tn === 'ZodDefault') {
              inner = inner._def.innerType;
            } else if (tn === 'ZodEffects') {
              inner = inner._def.schema;
            } else {
              break;
            }
          }

          if (inner?._def?.typeName === 'ZodArray') {
            listRefs.add(key);
          } else if (isChildRefSchema(fieldSchema, key)) {
            singleRefs.add(key);
          }
        }
      }
    }

    refMap[compApi.name] = [singleRefs, listRefs];
  }
  return refMap;
}

function* extractPointers(val: any, currentPath: string): Generator<[string, string]> {
  if (typeof val === 'string') {
    yield [val, currentPath];
  } else if (Array.isArray(val)) {
    for (let idx = 0; idx < val.length; idx++) {
      const item = val[idx];
      const subPath = `${currentPath}[${idx}]`;
      yield* extractPointers(item, subPath);
    }
  } else if (typeof val === 'object' && val !== null) {
    if ('componentId' in val && typeof val.componentId === 'string') {
      yield [val.componentId, `${currentPath}.componentId`];
    } else if ('child' in val && typeof val.child === 'string') {
      yield [val.child, `${currentPath}.child`];
    } else {
      for (const [subKey, subVal] of Object.entries(val)) {
        yield* extractPointers(subVal, `${currentPath}.${subKey}`);
      }
    }
  }
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
 * const refs = Array.from(getComponentReferences(boxComponent, STANDARD_REF_MAP));
 * ```
 */
export function* getComponentReferences(
  component: Record<string, any>,
  catalogOrRefMap: Catalog<any> | ComponentRefMap = STANDARD_REF_MAP,
): Generator<[string, string]> {
  if (!component || typeof component !== 'object') {
    return;
  }
  const refFieldsMap: ComponentRefMap =
    catalogOrRefMap instanceof Catalog ? buildComponentRefMap(catalogOrRefMap) : catalogOrRefMap;

  const compVal = component.component;
  let compType = '';
  let props: Record<string, any> = component;

  if (typeof compVal === 'string') {
    compType = compVal;
  } else if (typeof compVal === 'object' && compVal !== null) {
    compType = Object.keys(compVal)[0] ?? '';
    props = compVal[compType] ?? {};
  }

  if (!compType || typeof props !== 'object' || props === null) {
    return;
  }

  const refTuple = refFieldsMap[compType];
  const singleRefs = refTuple ? refTuple[0] : new Set<string>();
  const listRefs = refTuple ? refTuple[1] : new Set<string>();
  const isGeneric = !refTuple;

  for (const [key, value] of Object.entries(props)) {
    if (isGeneric) {
      if (key === 'id' || key === 'component' || key === 'weight') continue;
      if (
        key === 'child' ||
        key === 'children' ||
        key === 'next' ||
        key === 'trigger' ||
        key === 'content' ||
        key === 'tabs' ||
        key === 'items' ||
        key === 'components' ||
        key.endsWith('Child') ||
        key.endsWith('Children')
      ) {
        yield* extractPointers(value, key);
      }
    } else if (singleRefs.has(key) || listRefs.has(key)) {
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

/**
 * Validates the structural integrity of a list of component definitions.
 *
 * @param components Array of component definition objects to audit.
 * @param catalogOrRefMap Component reference field mapping definitions or Catalog instance.
 * @param options Integrity configuration options.
 * @throws {A2uiIntegrityError} If duplicate IDs, missing root, or dangling references are found.
 *
 * @example
 * ```ts
 * validateComponentIntegrity(components, STANDARD_REF_MAP, { rootId: 'root' });
 * ```
 */
export function validateComponentIntegrity(
  components: Array<Record<string, any>>,
  catalogOrRefMap: Catalog<any> | ComponentRefMap = STANDARD_REF_MAP,
  options: IntegrityOptions = {},
): void {
  const refFieldsMap: ComponentRefMap =
    catalogOrRefMap instanceof Catalog ? buildComponentRefMap(catalogOrRefMap) : catalogOrRefMap;
  const rootId = options.rootId ?? 'root';
  const allowDanglingReferences = options.allowDanglingReferences ?? false;
  const allowMissingRoot = options.allowMissingRoot ?? false;

  const ids = new Set<string>();

  // 1. Collect IDs and check for duplicates
  for (const comp of components) {
    if (!comp || typeof comp !== 'object') continue;
    const compId = comp.id;
    if (compId === undefined || compId === null) continue;
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
    for (const [refId, fieldName] of getComponentReferences(comp, refFieldsMap)) {
      if (!ids.has(refId)) {
        throw new A2uiIntegrityError(
          `Component '${compId}' references non-existent component '${refId}' in field '${fieldName}'`,
        );
      }
    }
  }
}

function traverseRecursionAndPaths(item: any, globalDepth: number, funcDepth: number): void {
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
    if ('path' in item && typeof item.path === 'string') {
      const path = item.path;
      if (!RELAXED_PATH_PATTERN.test(path)) {
        throw new A2uiValidationError(`Invalid path syntax: '${path}'`);
      }
    }

    const isFuncV08 =
      'functionCall' in item && typeof item.functionCall === 'object' && item.functionCall !== null;
    const isFuncV09 = 'call' in item && 'args' in item;

    if (isFuncV08) {
      traverseRecursionAndPaths(item.functionCall, globalDepth + 1, funcDepth);
    } else if (isFuncV09) {
      if (funcDepth >= MAX_FUNC_CALL_DEPTH) {
        throw new A2uiRecursionError(
          `Recursion limit exceeded: functionCall depth > ${MAX_FUNC_CALL_DEPTH}`,
        );
      }
      for (const [k, v] of Object.entries(item)) {
        if (k === 'args') {
          traverseRecursionAndPaths(v, globalDepth + 1, funcDepth + 1);
        } else {
          traverseRecursionAndPaths(v, globalDepth + 1, funcDepth);
        }
      }
    } else {
      for (const v of Object.values(item)) {
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
export function validateRecursionAndPaths(data: any): void {
  traverseRecursionAndPaths(data, 0, 0);
}
