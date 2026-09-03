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

import {childRefKindOf} from '../types/child-ref-helpers.js';
import type {Catalog, ComponentApi} from './types.js';

/**
 * Child reference properties for a single component type.
 */
export interface ComponentChildRefs {
  /** Property names holding single child component references. */
  readonly singleRefs: ReadonlySet<string>;
  /** Property names holding child list references or dynamic templates. */
  readonly listRefs: ReadonlySet<string>;
}

/** Map of component type names to child reference properties. */
export type ComponentRefMap = Record<string, ComponentChildRefs>;

/**
 * Result of checking whether a schema represents a component child reference or child list.
 */
export interface ChildRefAnalysis {
  /** Whether the schema represents a single child ComponentId reference. */
  isChild: boolean;
  /** Whether the schema represents a list of child references or a dynamic child template (ChildList). */
  isChildList: boolean;
}

/**
 * Options for configuring child reference analysis.
 */
export interface ChildRefAnalysisOptions {
  /** Set of definition names recognized as single child references. */
  childRefNames: ReadonlySet<string>;
  /** Set of definition names recognized as child list references. */
  childListRefNames: ReadonlySet<string>;
}

/**
 * Extracts the target definition name from a JSON Schema `$ref` pointer or URI.
 *
 * Examples:
 * - `https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList` -> `ChildList`
 * - `common_types.json#/definitions/ComponentId` -> `ComponentId`
 * - `#/definitions/Child` -> `Child`
 *
 * @param ref The JSON Schema reference string or URI.
 * @returns Target definition name.
 */
export function extractRefDefName(ref: string): string {
  if (!ref) return '';
  const hashIdx = ref.lastIndexOf('#');
  const target = hashIdx !== -1 ? ref.slice(hashIdx + 1) : ref;
  const segments = target.split('/').filter(Boolean);
  return segments.pop() ?? '';
}

function unwrapNextZodLayer(current: any, visited?: Set<any>): any {
  if (!current?._def) return null;
  if (visited) {
    if (visited.has(current)) return null;
    visited.add(current);
  }
  const typeName = current._def.typeName;
  switch (typeName) {
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodReadonly':
      return current._def.innerType;
    case 'ZodBranded':
      return current._def.type;
    case 'ZodEffects':
      return current._def.schema;
    case 'ZodLazy':
      return current._def.getter();
    default:
      return null;
  }
}

function getDescriptions(type: any): string[] {
  const descriptions: string[] = [];
  const visited = new Set<any>();
  let current = type;
  while (current) {
    if (current.description) descriptions.push(current.description);
    if (current._def?.description) descriptions.push(current._def.description);
    const next = unwrapNextZodLayer(current, visited);
    if (!next) break;
    current = next;
  }
  return descriptions;
}

function unwrapZodType(type: any): any {
  const visited = new Set<any>();
  let current = type;
  while (current) {
    const next = unwrapNextZodLayer(current, visited);
    if (!next) break;
    current = next;
  }
  return current;
}

function checkDirectJsonRef(
  ref: string,
  options: ChildRefAnalysisOptions,
): ChildRefAnalysis | null {
  if (!ref) return null;
  const defName = extractRefDefName(ref);
  const childListNames = options.childListRefNames;
  const childNames = options.childRefNames;

  if (childListNames.has(defName)) {
    return {isChild: false, isChildList: true};
  }
  if (childNames.has(defName)) {
    return {isChild: true, isChildList: false};
  }
  return null;
}

function checkCombinerList(
  list: unknown[],
  options: ChildRefAnalysisOptions,
): ChildRefAnalysis | null {
  let hasChild = false;
  for (const sub of list) {
    if (typeof sub !== 'object' || sub === null) continue;
    const subRes = checkJsonSchemaRef(sub as Record<string, any>, options);
    if (subRes.isChildList) return {isChild: false, isChildList: true};
    if (subRes.isChild) hasChild = true;
  }
  return hasChild ? {isChild: true, isChildList: false} : null;
}

function checkCombinerRefs(
  schema: Record<string, any>,
  options: ChildRefAnalysisOptions,
): ChildRefAnalysis | null {
  let hasChild = false;
  for (const combiner of ['oneOf', 'anyOf', 'allOf'] as const) {
    const list = schema[combiner];
    if (!Array.isArray(list)) continue;
    const res = checkCombinerList(list, options);
    if (res?.isChildList) return res;
    if (res?.isChild) hasChild = true;
  }
  return hasChild ? {isChild: true, isChildList: false} : null;
}

function checkJsonSchemaRef(
  schema: Record<string, any>,
  options: ChildRefAnalysisOptions,
): ChildRefAnalysis {
  const ref = typeof schema.$ref === 'string' ? schema.$ref : '';
  const directMatch = checkDirectJsonRef(ref, options);
  if (directMatch) return directMatch;

  if (schema.type === 'array' && schema.items) {
    const itemsRes = checkJsonSchemaRef(schema.items, options);
    if (itemsRes.isChild || itemsRes.isChildList) {
      return {isChild: false, isChildList: true};
    }
  }

  const combinerMatch = checkCombinerRefs(schema, options);
  if (combinerMatch) return combinerMatch;

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

function isTemplateShape(unwrappedOpt: any): boolean {
  if (
    unwrappedOpt?._def?.typeName === 'ZodObject' &&
    typeof unwrappedOpt._def.shape === 'function'
  ) {
    const shape = unwrappedOpt._def.shape();
    return Boolean(shape.componentId && shape.path);
  }
  return false;
}

function isArrayOfChild(unwrappedOpt: any, options: ChildRefAnalysisOptions): boolean {
  if (unwrappedOpt?._def?.typeName === 'ZodArray') {
    const elem = unwrapZodType(unwrappedOpt._def.type);
    return analyzeChildRefSchema(elem, options).isChild;
  }
  return false;
}

function analyzeUnionOptions(
  options: any[],
  analysisOptions: ChildRefAnalysisOptions,
): ChildRefAnalysis {
  let hasTemplate = false;
  let hasArrayOfChild = false;
  let hasChildRef = false;

  for (const opt of options) {
    const unwrappedOpt = unwrapZodType(opt);
    if (isTemplateShape(unwrappedOpt)) {
      hasTemplate = true;
    }
    if (isArrayOfChild(unwrappedOpt, analysisOptions)) {
      hasArrayOfChild = true;
    }

    const optRes = analyzeChildRefSchema(unwrappedOpt, analysisOptions);
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
  return {isChild: false, isChildList: false};
}

function isChildListDescription(desc: string, childListNames: ReadonlySet<string>): boolean {
  if (!desc) return false;
  if (desc.startsWith('REF:')) {
    const refTarget = extractRefDefName(desc.substring(4).split('|')[0]);
    if (childListNames.has(refTarget)) return true;
  }
  const refTarget = extractRefDefName(desc.split('|')[0]);
  if (refTarget && childListNames.has(refTarget)) {
    return true;
  }
  const trimmed = desc.trim();
  if (childListNames.has(trimmed)) {
    return true;
  }
  return false;
}

function isChildDescription(desc: string, childNames: ReadonlySet<string>): boolean {
  if (!desc) return false;
  if (desc.startsWith('REF:')) {
    const refTarget = extractRefDefName(desc.substring(4).split('|')[0]);
    if (childNames.has(refTarget)) return true;
  }
  const refTarget = extractRefDefName(desc.split('|')[0]);
  if (refTarget && childNames.has(refTarget)) {
    return true;
  }
  const trimmed = desc.trim();
  if (childNames.has(trimmed)) {
    return true;
  }
  return false;
}

function checkDescriptionChildRef(
  descriptions: string[],
  options: ChildRefAnalysisOptions,
): ChildRefAnalysis | null {
  const childListNames = options.childListRefNames;
  const childNames = options.childRefNames;

  for (const desc of descriptions) {
    if (isChildListDescription(desc, childListNames)) {
      return {isChild: false, isChildList: true};
    }
    if (isChildDescription(desc, childNames)) {
      return {isChild: true, isChildList: false};
    }
  }
  return null;
}

function analyzeZodArray(elem: any, options: ChildRefAnalysisOptions): ChildRefAnalysis {
  const elemRes = analyzeChildRefSchema(elem, options);
  if (elemRes.isChild || elemRes.isChildList) {
    return {isChild: false, isChildList: true};
  }
  return {isChild: false, isChildList: false};
}

/**
 * Analyzes a property schema (Zod schema or JSON Schema definition) to determine
 * if it represents a single component child reference (ComponentId) or child list (ChildList).
 *
 * Inspects explicit metadata stamps (`markChildRef`), $ref pointer targets (e.g.
 * `common_types.json#/$defs/ChildList`, `common_types.json#/$defs/ComponentId`,
 * `common_types.json#/$defs/Child`), schema descriptions with REF: prefixes,
 * structural unions (`{ componentId, path }` templates), and arrays of component IDs.
 *
 * @param schema Zod schema, JSON Schema object, or property schema definition.
 * @param options Required configuration specifying recognized child definition names.
 * @returns ChildRefAnalysis containing `isChild` and `isChildList` booleans.
 */
export function analyzeChildRefSchema(
  schema: unknown,
  options: ChildRefAnalysisOptions,
): ChildRefAnalysis {
  if (!schema || typeof schema !== 'object') {
    return {isChild: false, isChildList: false};
  }

  const directKind = childRefKindOf(schema as any);
  if (directKind === 'component-id') {
    return {isChild: true, isChildList: false};
  }
  if (directKind === 'child-list') {
    return {isChild: false, isChildList: true};
  }

  const descMatch = checkDescriptionChildRef(getDescriptions(schema), options);
  if (descMatch) return descMatch;

  const current = unwrapZodType(schema);
  if (!current?._def) {
    return checkJsonSchemaRef(schema as Record<string, any>, options);
  }

  const unwrappedKind = childRefKindOf(current);
  if (unwrappedKind === 'component-id') {
    return {isChild: true, isChildList: false};
  }
  if (unwrappedKind === 'child-list') {
    return {isChild: false, isChildList: true};
  }

  const typeName = current._def.typeName;

  if (typeName === 'ZodArray') {
    const elem = unwrapZodType(current._def.type);
    return analyzeZodArray(elem, options);
  }

  if (typeName === 'ZodUnion') {
    const unionOptions = (current._def.options as any[]) ?? [];
    return analyzeUnionOptions(unionOptions, options);
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
 * Returns whether the schema represents a single child ComponentId reference.
 *
 * @param schema The schema to evaluate.
 * @param options The child reference analysis options.
 * @returns Whether the schema is a single child reference.
 */
export function isChildSchema(schema: unknown, options: ChildRefAnalysisOptions): boolean {
  return analyzeChildRefSchema(schema, options).isChild;
}

/**
 * Returns whether the schema represents a child list or dynamic child template (ChildList).
 *
 * @param schema The schema to evaluate.
 * @param options The child reference analysis options.
 * @returns Whether the schema is a child list reference.
 */
export function isChildListSchema(schema: unknown, options: ChildRefAnalysisOptions): boolean {
  return analyzeChildRefSchema(schema, options).isChildList;
}

/**
 * Returns whether the schema represents either a single child or a child list.
 *
 * @param schema The schema to evaluate.
 * @param options The child reference analysis options.
 * @returns Whether the schema is any child or child list reference.
 */
export function isChildOrChildListSchema(
  schema: unknown,
  options: ChildRefAnalysisOptions,
): boolean {
  const res = analyzeChildRefSchema(schema, options);
  return res.isChild || res.isChildList;
}

function inspectShapeField(
  key: string,
  fieldSchema: unknown,
  singleRefs: Set<string>,
  listRefs: Set<string>,
  options: ChildRefAnalysisOptions,
): void {
  const res = analyzeChildRefSchema(fieldSchema, options);
  if (res.isChildList) {
    listRefs.add(key);
    return;
  }
  if (res.isChild) {
    singleRefs.add(key);
    return;
  }

  const inner = unwrapZodType(fieldSchema);
  if (inner?._def?.typeName === 'ZodArray') {
    const elem = unwrapZodType(inner._def.type);
    if (elem?._def?.typeName === 'ZodObject' && typeof elem._def.shape === 'function') {
      const elemShape = elem._def.shape();
      for (const [, subSchema] of Object.entries(elemShape)) {
        const subRes = analyzeChildRefSchema(subSchema, options);
        if (subRes.isChild || subRes.isChildList) {
          listRefs.add(key);
          break;
        }
      }
    }
  }
}

function inspectRawProperties(
  properties: Record<string, unknown>,
  singleRefs: Set<string>,
  listRefs: Set<string>,
  options: ChildRefAnalysisOptions,
): void {
  for (const [key, propSchema] of Object.entries(properties)) {
    const res = analyzeChildRefSchema(propSchema, options);
    if (res.isChildList) {
      listRefs.add(key);
    } else if (res.isChild) {
      singleRefs.add(key);
    }
  }
}

function inspectComponentSchema(
  schema: unknown,
  singleRefs: Set<string>,
  listRefs: Set<string>,
  options: ChildRefAnalysisOptions,
): void {
  if (!schema) return;

  const current = unwrapZodType(schema);
  if (current?._def?.typeName === 'ZodObject' && typeof current._def.shape === 'function') {
    const shape = current._def.shape();
    for (const [key, fieldSchema] of Object.entries(shape)) {
      inspectShapeField(key, fieldSchema, singleRefs, listRefs, options);
    }
    return;
  }

  if (typeof schema === 'object' && schema !== null && 'properties' in schema) {
    const rawProps = (schema as {properties?: Record<string, unknown>}).properties;
    if (typeof rawProps === 'object' && rawProps !== null) {
      inspectRawProperties(rawProps, singleRefs, listRefs, options);
    }
  }
}

/**
 * Builds a ComponentRefMap dynamically by inspecting component Zod schemas.
 *
 * @param catalogOrComponents Catalog instance, array of ComponentApi objects, or Map of ComponentApis.
 * @param options Required configuration specifying recognized child definition names.
 * @returns ComponentRefMap containing single and list reference properties.
 */
export function buildComponentRefMap(
  catalogOrComponents: Catalog<any, any> | ComponentApi[] | Map<string, ComponentApi>,
  options: ChildRefAnalysisOptions,
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

    inspectComponentSchema(compApi.schema, singleRefs, listRefs, options);

    refMap[compApi.name] = {singleRefs, listRefs};
  }

  return refMap;
}
