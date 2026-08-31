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

import type {Catalog, ComponentApi} from './types.js';

/** Map of component type names to sets of single and list child reference property names. */
export type ComponentRefMap = Record<string, [Set<string>, Set<string>]>;

/**
 * Result of checking whether a schema represents a component child reference or child list.
 */
export interface ChildRefAnalysis {
  /** Whether the schema represents a single child ComponentId reference. */
  isChild: boolean;
  /** Whether the schema represents a list of child references or a dynamic child template (ChildList). */
  isChildList: boolean;
}

function unwrapZodType(type: any): any {
  let current = type;
  while (current?._def) {
    const typeName = current._def.typeName;
    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodDefault' ||
      typeName === 'ZodReadonly'
    ) {
      current = current._def.innerType;
    } else if (typeName === 'ZodBranded') {
      current = current._def.type;
    } else if (typeName === 'ZodEffects') {
      current = current._def.schema;
    } else if (typeName === 'ZodLazy') {
      current = current._def.getter();
    } else {
      break;
    }
  }
  return current;
}

function checkJsonSchemaRef(schema: Record<string, any>): ChildRefAnalysis {
  const ref = typeof schema.$ref === 'string' ? schema.$ref : '';
  if (ref) {
    if (/(#|\/|\.)(ChildList)$/i.test(ref) || /common_types.*ChildList/i.test(ref)) {
      return {isChild: false, isChildList: true};
    }
    if (
      /(#|\/|\.)(ComponentId|Child)$/i.test(ref) ||
      /common_types.*(ComponentId|Child)$/i.test(ref)
    ) {
      return {isChild: true, isChildList: false};
    }
  }

  if (schema.type === 'array' && schema.items) {
    const itemsRes = checkJsonSchemaRef(schema.items);
    if (itemsRes.isChild || itemsRes.isChildList) {
      return {isChild: false, isChildList: true};
    }
  }

  let hasChild = false;
  for (const combiner of ['oneOf', 'anyOf', 'allOf'] as const) {
    if (Array.isArray(schema[combiner])) {
      for (const sub of schema[combiner]) {
        if (typeof sub === 'object' && sub !== null) {
          const subRes = checkJsonSchemaRef(sub);
          if (subRes.isChildList) return {isChild: false, isChildList: true};
          if (subRes.isChild) hasChild = true;
        }
      }
    }
  }
  if (hasChild) return {isChild: true, isChildList: false};

  if (
    schema.type === 'object' &&
    schema.properties &&
    'componentId' in schema.properties &&
    'path' in schema.properties
  ) {
    return {isChild: false, isChildList: true};
  }

  return {isChild: false, isChildList: false};
}

/**
 * Analyzes a property schema (Zod schema or JSON Schema definition) to determine
 * if it represents a single component child reference (ComponentId) or child list (ChildList).
 *
 * Inspects $ref pointer targets (e.g. `common_types.json#/$defs/ChildList`,
 * `common_types.json#/$defs/ComponentId`, `common_types.json#/$defs/Child`),
 * schema descriptions, structural unions (`{ componentId, path }` templates),
 * and arrays of component IDs.
 *
 * @param schema Zod schema, JSON Schema object, or property schema definition.
 * @returns ChildRefAnalysis containing `isChild` and `isChildList` booleans.
 */
export function analyzeChildRefSchema(schema: unknown): ChildRefAnalysis {
  if (!schema || typeof schema !== 'object') {
    return {isChild: false, isChildList: false};
  }

  const current = unwrapZodType(schema);
  if (!current?._def) {
    return checkJsonSchemaRef(schema as Record<string, any>);
  }

  const desc: string = current.description ?? current._def.description ?? '';
  if (
    /ChildList/i.test(desc) ||
    /common_types.*ChildList/i.test(desc) ||
    /Static child IDs or dynamic child template/i.test(desc)
  ) {
    return {isChild: false, isChildList: true};
  }
  if (
    /ComponentId/i.test(desc) ||
    /Child/i.test(desc) ||
    /The unique identifier for a component/i.test(desc) ||
    /common_types.*(ComponentId|Child)/i.test(desc)
  ) {
    return {isChild: true, isChildList: false};
  }

  const typeName = current._def.typeName;

  if (typeName === 'ZodArray') {
    const elem = unwrapZodType(current._def.type);
    const elemRes = analyzeChildRefSchema(elem);
    if (elemRes.isChild || elemRes.isChildList) {
      return {isChild: false, isChildList: true};
    }
    const elemDesc: string = elem?.description ?? elem?._def?.description ?? '';
    if (
      elemDesc.includes('ComponentId') ||
      elemDesc.includes('unique identifier for a component') ||
      elemDesc.includes('child component')
    ) {
      return {isChild: false, isChildList: true};
    }
  }

  if (typeName === 'ZodUnion') {
    const options = (current._def.options as any[]) ?? [];
    let hasTemplate = false;
    let hasArrayOfChild = false;
    let hasChildRef = false;

    for (const opt of options) {
      const unwrappedOpt = unwrapZodType(opt);
      const optTypeName = unwrappedOpt?._def?.typeName;

      if (optTypeName === 'ZodObject' && typeof unwrappedOpt._def.shape === 'function') {
        const shape = unwrappedOpt._def.shape();
        if (shape.componentId && shape.path) {
          hasTemplate = true;
        }
      }

      if (optTypeName === 'ZodArray') {
        const elem = unwrapZodType(unwrappedOpt._def.type);
        const elemRes = analyzeChildRefSchema(elem);
        if (elemRes.isChild) {
          hasArrayOfChild = true;
        }
      }

      const optRes = analyzeChildRefSchema(unwrappedOpt);
      if (optRes.isChildList) {
        return {isChild: false, isChildList: true};
      }
      if (optRes.isChild) {
        hasChildRef = true;
      }
    }

    if (hasTemplate || hasArrayOfChild) {
      return {isChild: false, isChildList: true};
    }
    if (hasChildRef) {
      return {isChild: true, isChildList: false};
    }
  }

  if (typeName === 'ZodObject' && typeof current._def.shape === 'function') {
    const shape = current._def.shape();
    if (shape.componentId && shape.path) {
      return {isChild: false, isChildList: true};
    }
  }

  return {isChild: false, isChildList: false};
}

/**
 * Returns true if the schema represents a single child ComponentId reference.
 */
export function isChildSchema(schema: unknown): boolean {
  return analyzeChildRefSchema(schema).isChild;
}

/**
 * Returns true if the schema represents a child list or dynamic child template (ChildList).
 */
export function isChildListSchema(schema: unknown): boolean {
  return analyzeChildRefSchema(schema).isChildList;
}

/**
 * Returns true if the schema represents either a single child or a child list.
 */
export function isChildOrChildListSchema(schema: unknown): boolean {
  const res = analyzeChildRefSchema(schema);
  return res.isChild || res.isChildList;
}

/**
 * Builds a ComponentRefMap dynamically by inspecting component Zod schemas.
 *
 * @param catalogOrComponents Catalog instance, array of ComponentApi objects, or Map of ComponentApis.
 * @returns ComponentRefMap containing single and list reference properties.
 */
export function buildComponentRefMap(
  catalogOrComponents: Catalog<any, any> | ComponentApi[] | Map<string, ComponentApi>,
): ComponentRefMap {
  const refMap: ComponentRefMap = {};
  const componentApis: ComponentApi[] =
    typeof (catalogOrComponents as any)?.components?.values === 'function'
      ? Array.from((catalogOrComponents as any).components.values())
      : Array.isArray(catalogOrComponents)
        ? catalogOrComponents
        : Array.from((catalogOrComponents as Map<string, ComponentApi>).values());

  for (const compApi of componentApis) {
    const singleRefs = new Set<string>();
    const listRefs = new Set<string>();

    if (compApi.schema) {
      const current = unwrapZodType(compApi.schema);
      if (current?._def?.typeName === 'ZodObject' && typeof current._def.shape === 'function') {
        const shape = current._def.shape();
        for (const [key, fieldSchema] of Object.entries(shape)) {
          const res = analyzeChildRefSchema(fieldSchema);
          if (res.isChildList) {
            listRefs.add(key);
          } else if (res.isChild) {
            singleRefs.add(key);
          } else {
            const inner = unwrapZodType(fieldSchema);
            if (inner?._def?.typeName === 'ZodArray') {
              const elem = unwrapZodType(inner._def.type);
              if (elem?._def?.typeName === 'ZodObject' && typeof elem._def.shape === 'function') {
                const elemShape = elem._def.shape();
                for (const [, subSchema] of Object.entries(elemShape)) {
                  const subRes = analyzeChildRefSchema(subSchema);
                  if (subRes.isChild || subRes.isChildList) {
                    listRefs.add(key);
                  }
                }
              }
            }
          }
        }
      } else if (
        typeof compApi.schema === 'object' &&
        compApi.schema !== null &&
        'properties' in compApi.schema
      ) {
        const rawProps = (compApi.schema as any).properties;
        if (typeof rawProps === 'object' && rawProps !== null) {
          for (const [key, propSchema] of Object.entries(rawProps)) {
            const res = analyzeChildRefSchema(propSchema);
            if (res.isChildList) {
              listRefs.add(key);
            } else if (res.isChild) {
              singleRefs.add(key);
            }
          }
        }
      }
    }

    refMap[compApi.name] = [singleRefs, listRefs];
  }

  return refMap;
}
