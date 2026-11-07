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
  canSchemaHoldListRef,
  canSchemaHoldSingleRef,
  extractRefDefName,
  extractRefFields,
  getUnionOptions,
  isTemplateRefObject,
  unwrapZodField,
} from '../resolution/ref-fields.js';
import type {Catalog, ComponentApi, FunctionApi} from './types.js';

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
    const subRes = checkJsonSchemaRef(sub as Record<string, unknown>, options);
    if (subRes.isChildList) return {isChild: false, isChildList: true};
    if (subRes.isChild) hasChild = true;
  }
  return hasChild ? {isChild: true, isChildList: false} : null;
}

function checkCombinerRefs(
  schema: Record<string, unknown>,
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
  schema: Record<string, unknown>,
  options: ChildRefAnalysisOptions,
): ChildRefAnalysis {
  const ref = typeof schema.$ref === 'string' ? schema.$ref : '';
  const directMatch = checkDirectJsonRef(ref, options);
  if (directMatch) return directMatch;

  if (schema.type === 'array' && typeof schema.items === 'object' && schema.items !== null) {
    const itemsRes = checkJsonSchemaRef(schema.items as Record<string, unknown>, options);
    if (itemsRes.isChild || itemsRes.isChildList) {
      return {isChild: false, isChildList: true};
    }
  }

  const combinerMatch = checkCombinerRefs(schema, options);
  if (combinerMatch) return combinerMatch;

  const props =
    typeof schema.properties === 'object' && schema.properties !== null
      ? (schema.properties as Record<string, unknown>)
      : undefined;
  if (
    schema.type === 'object' &&
    props &&
    ((Object.hasOwn(props, 'componentId') &&
      (Object.hasOwn(props, 'path') ||
        Object.hasOwn(props, '@path') ||
        Object.hasOwn(props, 'dataBinding'))) ||
      Object.hasOwn(props, 'explicitList') ||
      Object.hasOwn(props, 'template'))
  ) {
    return {isChild: false, isChildList: true};
  }

  return {isChild: false, isChildList: false};
}

function analyzeUnionOptions(
  options: z.ZodTypeAny[],
  analysisOptions: ChildRefAnalysisOptions,
  path: Set<unknown>,
): ChildRefAnalysis {
  let hasChildRef = false;

  for (const opt of options) {
    const optRes = analyzeChildRefSchemaOnPath(opt, analysisOptions, path);
    if (optRes.isChildList) {
      return {isChild: false, isChildList: true};
    }
    if (optRes.isChild) {
      hasChildRef = true;
    }
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
  elem: z.ZodTypeAny,
  options: ChildRefAnalysisOptions,
  path: Set<unknown>,
): ChildRefAnalysis {
  const elemRes = analyzeChildRefSchemaOnPath(elem, options, path);
  if (elemRes.isChild || elemRes.isChildList) {
    return {isChild: false, isChildList: true};
  }
  return {isChild: false, isChildList: false};
}

function analyzeIntersectedSchemas(
  left: z.ZodTypeAny,
  right: z.ZodTypeAny,
  options: ChildRefAnalysisOptions,
  path: Set<unknown>,
  outerMatch?: ChildRefAnalysis | null,
): ChildRefAnalysis {
  const leftRes = analyzeChildRefSchemaOnPath(left, options, path);
  const rightRes = analyzeChildRefSchemaOnPath(right, options, path);

  const isList =
    (Boolean(outerMatch?.isChildList) &&
      canSchemaHoldListRef(left, options) &&
      canSchemaHoldListRef(right, options)) ||
    (leftRes.isChildList && canSchemaHoldListRef(right, options)) ||
    (rightRes.isChildList && canSchemaHoldListRef(left, options));
  if (isList) {
    return {isChild: false, isChildList: true};
  }

  const isSingle =
    (Boolean(outerMatch?.isChild) &&
      canSchemaHoldSingleRef(left, options) &&
      canSchemaHoldSingleRef(right, options)) ||
    (leftRes.isChild && canSchemaHoldSingleRef(right, options)) ||
    (rightRes.isChild && canSchemaHoldSingleRef(left, options)) ||
    (leftRes.isChildList &&
      canSchemaHoldSingleRef(left, options) &&
      canSchemaHoldSingleRef(right, options)) ||
    (rightRes.isChildList &&
      canSchemaHoldSingleRef(right, options) &&
      canSchemaHoldSingleRef(left, options));
  if (isSingle) {
    return {isChild: true, isChildList: false};
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
  if (!('_def' in schema) || !(schema as z.ZodTypeAny)._def) {
    return checkJsonSchemaRef(schema as Record<string, unknown>, options);
  }

  const field = unwrapZodField(schema as z.ZodTypeAny);
  for (const s of field.traversed) {
    if (s !== schema && path.has(s)) {
      return {isChild: false, isChildList: false};
    }
  }

  const explicitMatch: ChildRefAnalysis | null = field.refs.has('child-list')
    ? {isChild: false, isChildList: true}
    : field.refs.has('component-id')
      ? {isChild: true, isChildList: false}
      : checkDescriptionChildRef(field.descriptions, options);

  const current = field.schema;
  if (!current?._def) {
    return explicitMatch ?? {isChild: false, isChildList: false};
  }

  if (current !== schema && path.has(current)) {
    return {isChild: false, isChildList: false};
  }

  const nextPath = new Set(path);
  for (const s of field.traversed) {
    nextPath.add(s);
  }
  nextPath.add(current);

  const typeName = current._def.typeName as string;

  // Zod's `.and()` copies the left operand's `description` onto the `ZodIntersection`,
  // so verify compatibility against both sides before trusting an outer marker.
  if (typeName === 'ZodIntersection') {
    const def = current._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
    return analyzeIntersectedSchemas(def.left, def.right, options, nextPath, explicitMatch);
  }

  if (explicitMatch?.isChildList) {
    return explicitMatch;
  }

  // Zod's `.or()` copies the first operand's `description` onto the `ZodUnion`,
  // so inspect all union branches before settling on `isChild: true`.
  const unionOptions = getUnionOptions(current);
  if (unionOptions) {
    const unionRes = analyzeUnionOptions(unionOptions, options, nextPath);
    if (unionRes.isChildList) {
      return unionRes;
    }
    if (unionRes.isChild || explicitMatch?.isChild) {
      return {isChild: true, isChildList: false};
    }
    return {isChild: false, isChildList: false};
  }

  if (explicitMatch) {
    return explicitMatch;
  }

  if (typeName === 'ZodArray') {
    return analyzeZodArray(current._def.type as z.ZodTypeAny, options, nextPath);
  }

  if (typeName === 'ZodPipeline') {
    const def = current._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
    const pipeIn = def['in'];
    const pipeOut = def['out'];
    const inField = unwrapZodField(pipeIn);
    if (inField.hasTransform) {
      const inRes = analyzeChildRefSchemaOnPath(pipeIn, options, nextPath);
      if (inRes.isChild || inRes.isChildList) {
        return inRes;
      }
      const outRes = analyzeChildRefSchemaOnPath(pipeOut, options, nextPath);
      if (outRes.isChildList && canSchemaHoldListRef(pipeIn, options)) {
        return {isChild: false, isChildList: true};
      }
      if (outRes.isChild && canSchemaHoldSingleRef(pipeIn, options)) {
        return {isChild: true, isChildList: false};
      }
      return {isChild: false, isChildList: false};
    }
    return analyzeIntersectedSchemas(pipeIn, pipeOut, options, nextPath);
  }

  if (isTemplateRefObject(current)) {
    return {isChild: false, isChildList: true};
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

function canRawSchemaHoldString(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return obj['type'] === undefined || obj['type'] === 'string';
}

function canRawSchemaHoldStringArray(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (obj['type'] === undefined) return true;
  if (obj['type'] !== 'array') return false;
  return obj['items'] === undefined || canRawSchemaHoldString(obj['items']);
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
      (propSchema as Record<string, unknown>)['type'] === 'array' &&
      canRawSchemaHoldStringArray(propSchema)
    ) {
      acc.listRefs.add(key);
      continue;
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
  const extraRule = rawSchema['additionalProperties'] ?? rawSchema['unevaluatedProperties'];
  if (canRawSchemaHoldString(extraRule) && (!rawProps || !Object.hasOwn(rawProps, 'child'))) {
    acc.singleRefs.add('child');
  }
  if (
    canRawSchemaHoldStringArray(extraRule) &&
    (!rawProps || !Object.hasOwn(rawProps, 'children'))
  ) {
    acc.listRefs.add('children');
  }
}

/**
 * Builds a ComponentRefMap dynamically by inspecting component Zod schemas.
 *
 * @param catalogOrComponents Catalog instance, array of ComponentApi objects, or Map of ComponentApis.
 * @param options Required configuration specifying recognized child definition names.
 * @returns ComponentRefMap containing single, list, and nested reference properties.
 */
export function buildComponentRefMap<
  T extends ComponentApi = ComponentApi,
  F extends FunctionApi = FunctionApi,
>(
  catalogOrComponents: Catalog<T, F> | ReadonlyArray<T> | ReadonlyMap<string, T>,
  options: ChildRefAnalysisOptions,
): ComponentRefMap {
  const refMap: ComponentRefMap = {};
  const maybeCatalog = catalogOrComponents as {components?: ReadonlyMap<string, T>};
  const componentApis: ReadonlyArray<ComponentApi> =
    typeof maybeCatalog?.components?.values === 'function'
      ? Array.from(maybeCatalog.components.values())
      : Array.isArray(catalogOrComponents)
        ? catalogOrComponents
        : Array.from((catalogOrComponents as ReadonlyMap<string, T>).values());

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
