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

import {z} from 'zod';

import {
  type ChildRefAnalysisOptions,
  extractRefDefName,
  extractRefFields,
} from '../resolution/ref-fields.js';
import {childRefKindOf} from '../types/child-ref-helpers.js';
import type {Catalog, ComponentApi} from './types.js';

export {type ChildRefAnalysisOptions, extractRefDefName};

/**
 * Child reference properties for a single component type.
 */
export interface ComponentChildRefs {
  /** Property names holding single child component references. */
  readonly singleRefs: ReadonlySet<string>;
  /** Property names holding child list references or dynamic templates. */
  readonly listRefs: ReadonlySet<string>;
  /**
   * Mapping of list property names to item sub-keys that hold child references.
   *
   * Used for list properties whose items are structured objects rather than
   * plain string component IDs. Keys are property names that also appear in
   * {@link listRefs}. A property is absent when its items are plain references
   * rather than objects, or when the schema declared no child-bearing sub-key.
   * Consumers treat an absent entry as "inspect every sub-key", preserving
   * fallback behavior.
   */
  readonly nestedRefs?: Readonly<Record<string, ReadonlySet<string>>>;
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
    case 'ZodCatch':
      return current._def.innerType;
    case 'ZodBranded':
      return current._def.type;
    case 'ZodEffects':
      return current._def.schema;
    case 'ZodPipeline':
      return current._def['out'];
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

function getChildRefKindFromChain(type: any): ReturnType<typeof childRefKindOf> {
  const visited = new Set<any>();
  let current = type;
  while (current) {
    const kind = childRefKindOf(current);
    if (kind) return kind;
    const next = unwrapNextZodLayer(current, visited);
    if (!next) break;
    current = next;
  }
  return undefined;
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
    ((Object.hasOwn(schema.properties, 'componentId') &&
      (Object.hasOwn(schema.properties, 'path') ||
        Object.hasOwn(schema.properties, '@path') ||
        Object.hasOwn(schema.properties, 'dataBinding'))) ||
      Object.hasOwn(schema.properties, 'explicitList') ||
      Object.hasOwn(schema.properties, 'template'))
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
    return Boolean(
      (shape.componentId && (shape.path || shape['@path'] || shape.dataBinding)) ||
      shape.explicitList ||
      shape.template,
    );
  }
  return false;
}

function isArrayOfChild(
  unwrappedOpt: any,
  options: ChildRefAnalysisOptions,
  path: Set<unknown>,
): boolean {
  if (unwrappedOpt?._def?.typeName === 'ZodArray') {
    return analyzeChildRefSchemaOnPath(unwrappedOpt._def.type, options, path).isChild;
  }
  return false;
}

function analyzeUnionOptions(
  options: any[],
  analysisOptions: ChildRefAnalysisOptions,
  path: Set<unknown>,
): ChildRefAnalysis {
  let hasTemplate = false;
  let hasArrayOfChild = false;
  let hasChildRef = false;

  for (const opt of options) {
    const unwrappedOpt = unwrapZodType(opt);
    if (isTemplateShape(unwrappedOpt)) {
      hasTemplate = true;
    }
    if (isArrayOfChild(unwrappedOpt, analysisOptions, path)) {
      hasArrayOfChild = true;
    }

    const optRes = analyzeChildRefSchemaOnPath(opt, analysisOptions, path);
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

function analyzeZodArray(
  elem: any,
  options: ChildRefAnalysisOptions,
  path: Set<unknown>,
): ChildRefAnalysis {
  const elemRes = analyzeChildRefSchemaOnPath(elem, options, path);
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
  return analyzeChildRefSchemaOnPath(schema, options, new Set());
}

/**
 * Implements {@link analyzeChildRefSchema} while tracking the schemas on the
 * current recursion path.
 *
 * A schema found in `path` means the traversal has looped back into one of its
 * own ancestors (for example through a recursive `z.lazy()` union), so the
 * branch is treated as a non-reference. Entries are removed when their branch
 * returns, so sibling properties and union options can reuse one schema
 * instance and still be analyzed.
 */
function analyzeChildRefSchemaOnPath(
  schema: unknown,
  options: ChildRefAnalysisOptions,
  path: Set<unknown>,
): ChildRefAnalysis {
  if (!schema || typeof schema !== 'object') {
    return {isChild: false, isChildList: false};
  }
  if (path.has(schema)) {
    return {isChild: false, isChildList: false};
  }

  path.add(schema);
  try {
    return analyzeSchemaNode(schema, options, path);
  } finally {
    path.delete(schema);
  }
}

function analyzeSchemaNode(
  schema: object,
  options: ChildRefAnalysisOptions,
  path: Set<unknown>,
): ChildRefAnalysis {
  const directKind = getChildRefKindFromChain(schema);
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

  if (current !== schema && path.has(current)) {
    return {isChild: false, isChildList: false};
  }

  const typeName = current._def.typeName;

  if (typeName === 'ZodArray') {
    return analyzeZodArray(current._def.type, options, path);
  }

  if (typeName === 'ZodUnion') {
    const unionOptions = (current._def.options as any[]) ?? [];
    return analyzeUnionOptions(unionOptions, options, path);
  }

  if (typeName === 'ZodObject' && typeof current._def.shape === 'function') {
    const shape = current._def.shape();
    if (
      (shape.componentId && (shape.path || shape['@path'] || shape.dataBinding)) ||
      shape.explicitList ||
      shape.template
    ) {
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

/** Mutable collector threaded through schema inspection. */
interface ChildRefAccumulator {
  readonly singleRefs: Set<string>;
  readonly listRefs: Set<string>;
  readonly nestedRefs: Record<string, Set<string>>;
}

function addNestedRef(acc: ChildRefAccumulator, key: string, subKey: string): void {
  const existing = acc.nestedRefs[key];
  if (existing) {
    existing.add(subKey);
    return;
  }
  acc.nestedRefs[key] = new Set([subKey]);
}

/**
 * Returns the `properties` of an array property's item schema, or null when the
 * schema is not an array of inline structured objects.
 */
function rawArrayItemProperties(propSchema: unknown): Record<string, unknown> | null {
  if (typeof propSchema !== 'object' || propSchema === null) return null;

  const schema = propSchema as Record<string, unknown>;
  if (schema['type'] !== 'array' && !Object.hasOwn(schema, 'items')) return null;

  const items = schema['items'];
  if (typeof items !== 'object' || items === null) return null;

  const itemProps = (items as Record<string, unknown>)['properties'];
  if (typeof itemProps !== 'object' || itemProps === null) return null;

  return itemProps as Record<string, unknown>;
}

function inspectRawProperties(
  properties: Record<string, unknown>,
  acc: ChildRefAccumulator,
  options: ChildRefAnalysisOptions,
): void {
  for (const [key, propSchema] of Object.entries(properties)) {
    const res = analyzeChildRefSchema(propSchema, options);
    if (res.isChildList) {
      acc.listRefs.add(key);
      continue;
    }
    if (res.isChild) {
      acc.singleRefs.add(key);
      continue;
    }
    const isSingleChildKey = key === 'child' || Boolean(options.childPropertyNames?.has(key));
    if (
      isSingleChildKey &&
      typeof propSchema === 'object' &&
      propSchema !== null &&
      (propSchema as Record<string, unknown>)['type'] === 'string'
    ) {
      acc.singleRefs.add(key);
      continue;
    }
    if (
      key === 'children' &&
      typeof propSchema === 'object' &&
      propSchema !== null &&
      (propSchema as Record<string, unknown>)['type'] === 'array'
    ) {
      const items = (propSchema as Record<string, unknown>)['items'];
      if (
        !items ||
        (typeof items === 'object' && (items as Record<string, unknown>)['type'] === 'string')
      ) {
        acc.listRefs.add(key);
        continue;
      }
    }

    const itemProps = rawArrayItemProperties(propSchema);
    if (!itemProps) continue;

    for (const [subKey, subSchema] of Object.entries(itemProps)) {
      const subRes = analyzeChildRefSchema(subSchema, options);
      const isSingleSubKey = subKey === 'child' || Boolean(options.childPropertyNames?.has(subKey));
      if (
        subRes.isChild ||
        subRes.isChildList ||
        (isSingleSubKey &&
          typeof subSchema === 'object' &&
          subSchema !== null &&
          (subSchema as Record<string, unknown>)['type'] === 'string')
      ) {
        acc.listRefs.add(key);
        addNestedRef(acc, key, subKey);
      }
    }
  }
}

function inspectComponentSchema(
  schema: unknown,
  acc: ChildRefAccumulator,
  options: ChildRefAnalysisOptions,
): void {
  if (!schema || typeof schema !== 'object') return;

  if ('_def' in schema && (schema as z.ZodTypeAny)._def) {
    const refFields = extractRefFields(schema as z.ZodTypeAny, options);
    for (const [key, refKind] of refFields) {
      if (refKind.kind === 'single') {
        acc.singleRefs.add(key);
      } else if (refKind.kind === 'list') {
        acc.listRefs.add(key);
      } else if (refKind.kind === 'nested') {
        acc.listRefs.add(key);
        for (const subKey of refKind.keys) {
          addNestedRef(acc, key, subKey);
        }
      }
    }
    return;
  }

  const rawSchema = schema as Record<string, unknown>;
  const rawProps =
    typeof rawSchema['properties'] === 'object' && rawSchema['properties'] !== null
      ? (rawSchema['properties'] as Record<string, unknown>)
      : undefined;
  if (rawProps) {
    inspectRawProperties(rawProps, acc, options);
  }
  const isEmptyRawObject =
    rawSchema['type'] === 'object' &&
    (!rawProps || Object.keys(rawProps).length === 0) &&
    rawSchema['additionalProperties'] !== false;
  const isOpenRawObject =
    rawSchema['additionalProperties'] === true || rawSchema['unevaluatedProperties'] === true;
  if (isEmptyRawObject || isOpenRawObject) {
    if (!rawProps || !Object.hasOwn(rawProps, 'child')) {
      acc.singleRefs.add('child');
    }
    if (!rawProps || !Object.hasOwn(rawProps, 'children')) {
      acc.listRefs.add('children');
    }
  }
}

/**
 * Builds a ComponentRefMap dynamically by inspecting component Zod schemas.
 *
 * @param catalogOrComponents Catalog instance, array of ComponentApi objects, or Map of ComponentApis.
 * @param options Required configuration specifying recognized child definition names.
 * @returns ComponentRefMap containing single, list, and nested reference properties.
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
    const acc: ChildRefAccumulator = {
      singleRefs: new Set<string>(),
      listRefs: new Set<string>(),
      nestedRefs: {},
    };

    inspectComponentSchema(compApi.schema, acc, options);

    refMap[compApi.name] = {
      singleRefs: acc.singleRefs,
      listRefs: acc.listRefs,
      nestedRefs: acc.nestedRefs,
    };
  }

  return refMap;
}
