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

import type {SchemaCursor, SchemaDoc} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';
import {toSchemaDoc} from '../schema-engine/zod-bridge.js';
import {
  type ChildRefAnalysisOptions,
  canSchemaHoldListRef,
  canSchemaHoldSingleRef,
  extractRefDefName,
  extractRefFields,
  schemaDiscovery,
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

const NONE: ChildRefAnalysis = {isChild: false, isChildList: false};
const CHILD: ChildRefAnalysis = {isChild: true, isChildList: false};
const CHILD_LIST: ChildRefAnalysis = {isChild: false, isChildList: true};

function matchesName(desc: string, names: ReadonlySet<string>): boolean {
  if (!desc) return false;
  if (desc.startsWith('REF:') && names.has(extractRefDefName(desc.substring(4).split('|')[0]))) {
    return true;
  }
  const refTarget = extractRefDefName(desc.split('|')[0]);
  return (refTarget !== '' && names.has(refTarget)) || names.has(desc.trim());
}

/** A child-ref match from `$ref` definition names, then from descriptions. */
function explicitMatch(
  field: ReturnType<typeof schemaDiscovery.unwrap>,
  options: ChildRefAnalysisOptions,
): ChildRefAnalysis | null {
  if (field.refs.has('child-list')) return CHILD_LIST;
  if (field.refs.has('component-id')) return CHILD;
  for (const name of [...field.refDefNames, ...field.localDefNames]) {
    if (options.childListRefNames.has(name)) return CHILD_LIST;
    if (options.childRefNames.has(name)) return CHILD;
  }
  for (const desc of field.descriptions) {
    if (matchesName(desc, options.childListRefNames)) return CHILD_LIST;
    if (matchesName(desc, options.childRefNames)) return CHILD;
  }
  return null;
}

function analyzeUnionOptions(
  members: readonly SchemaCursor[],
  options: ChildRefAnalysisOptions,
  path: Set<unknown>,
): ChildRefAnalysis {
  let hasChildRef = false;
  for (const opt of members) {
    const optRes = analyzeOnPath(opt, options, path);
    if (optRes.isChildList) return CHILD_LIST;
    if (optRes.isChild) hasChildRef = true;
  }
  return hasChildRef ? CHILD : NONE;
}

function analyzeIntersectedSchemas(
  left: SchemaCursor,
  right: SchemaCursor,
  options: ChildRefAnalysisOptions,
  path: Set<unknown>,
  outerMatch: ChildRefAnalysis | null,
): ChildRefAnalysis {
  const leftRes = analyzeOnPath(left, options, path);
  const rightRes = analyzeOnPath(right, options, path);
  const holdsList = (c: SchemaCursor) => canSchemaHoldListRef(c.node, c.doc, options);
  const holdsSingle = (c: SchemaCursor) => canSchemaHoldSingleRef(c.node, c.doc, options);

  const isList =
    (Boolean(outerMatch?.isChildList) && holdsList(left) && holdsList(right)) ||
    (leftRes.isChildList && holdsList(right)) ||
    (rightRes.isChildList && holdsList(left));
  if (isList) return CHILD_LIST;

  const isSingle =
    (Boolean(outerMatch?.isChild) && holdsSingle(left) && holdsSingle(right)) ||
    (leftRes.isChild && holdsSingle(right)) ||
    (rightRes.isChild && holdsSingle(left)) ||
    (leftRes.isChildList && holdsSingle(left) && holdsSingle(right)) ||
    (rightRes.isChildList && holdsSingle(right) && holdsSingle(left));
  return isSingle ? CHILD : NONE;
}

/**
 * Analyzes a property schema to determine if it represents a single component
 * child reference (ComponentId) or child list (ChildList).
 *
 * Inspects `$ref` targets (e.g. `common_types.json#/$defs/ChildList`,
 * `common_types.json#/$defs/ComponentId`, `common_types.json#/$defs/Child`), schema
 * descriptions with `REF:` prefixes, structural unions (`{ componentId, path }`
 * templates and v0.8 `explicitList`/`template`), intersections, and arrays of
 * component IDs. A `$ref` that does not resolve is classified by its target name.
 *
 * @param node The property schema.
 * @param doc The document that owns `node`.
 * @param options Required configuration specifying recognized child definition names.
 * @returns ChildRefAnalysis containing `isChild` and `isChildList` booleans.
 */
export function analyzeChildRefSchema(
  node: JsonSchema,
  doc: SchemaDoc,
  options: ChildRefAnalysisOptions,
): ChildRefAnalysis {
  return analyzeOnPath({node, doc}, options, new Set());
}

/**
 * Implements {@link analyzeChildRefSchema} while tracking the schema nodes on the
 * current recursion path.
 *
 * A node found in `path` means the traversal has looped back into one of its
 * own ancestors (for example through a recursive `$ref`), so the branch is treated
 * as a non-reference. Entries are removed when their branch returns, so sibling
 * properties and union options can reuse one schema object and still be analyzed.
 */
function analyzeOnPath(
  c: SchemaCursor,
  options: ChildRefAnalysisOptions,
  path: Set<unknown>,
): ChildRefAnalysis {
  const schema = c.node;
  if (!schema || typeof schema !== 'object') return NONE;
  if (path.has(schema)) return NONE;
  path.add(schema);
  try {
    return analyzeSchemaNode(c, options, path);
  } finally {
    path.delete(schema);
  }
}

function analyzeSchemaNode(
  c: SchemaCursor,
  options: ChildRefAnalysisOptions,
  path: Set<unknown>,
): ChildRefAnalysis {
  const field = schemaDiscovery.unwrap(c);
  for (const s of field.traversed) {
    if (s !== c.node && path.has(s)) return NONE;
  }

  const match = explicitMatch(field, options);
  const current = field.node;
  if (current !== c.node && path.has(current)) return NONE;

  const nextPath = new Set(path);
  for (const s of field.traversed) nextPath.add(s);
  nextPath.add(current);

  const kind = schemaDiscovery.kindOf(current);

  // A combinator's description may be copied from one member, so verify
  // compatibility against both sides before trusting an outer marker.
  if (kind === 'intersection') {
    const [left, right] = schemaDiscovery.intersectionSides(field);
    return analyzeIntersectedSchemas(left, right, options, nextPath, match);
  }

  if (match?.isChildList) return match;

  // Inspect all union members before settling on `isChild: true`.
  if (kind === 'union') {
    const unionRes = analyzeUnionOptions(
      schemaDiscovery.unionOptions(field) ?? [],
      options,
      nextPath,
    );
    if (unionRes.isChildList) return unionRes;
    return unionRes.isChild || match?.isChild ? CHILD : NONE;
  }

  if (match) return match;

  if (kind === 'array') {
    const elemRes = analyzeOnPath(schemaDiscovery.arrayElement(field), options, nextPath);
    return elemRes.isChild || elemRes.isChildList ? CHILD_LIST : NONE;
  }

  return schemaDiscovery.isTemplateRef(field) ? CHILD_LIST : NONE;
}

/**
 * Returns whether the schema represents a single child ComponentId reference.
 *
 * @param node The schema to evaluate.
 * @param doc The document that owns `node`.
 * @param options The child reference analysis options.
 * @returns Whether the schema is a single child reference.
 */
export function isChildSchema(
  node: JsonSchema,
  doc: SchemaDoc,
  options: ChildRefAnalysisOptions,
): boolean {
  return analyzeChildRefSchema(node, doc, options).isChild;
}

/**
 * Returns whether the schema represents a child list or dynamic child template (ChildList).
 *
 * @param node The schema to evaluate.
 * @param doc The document that owns `node`.
 * @param options The child reference analysis options.
 * @returns Whether the schema is a child list reference.
 */
export function isChildListSchema(
  node: JsonSchema,
  doc: SchemaDoc,
  options: ChildRefAnalysisOptions,
): boolean {
  return analyzeChildRefSchema(node, doc, options).isChildList;
}

/**
 * Returns whether the schema represents either a single child or a child list.
 *
 * @param node The schema to evaluate.
 * @param doc The document that owns `node`.
 * @param options The child reference analysis options.
 * @returns Whether the schema is any child or child list reference.
 */
export function isChildOrChildListSchema(
  node: JsonSchema,
  doc: SchemaDoc,
  options: ChildRefAnalysisOptions,
): boolean {
  const res = analyzeChildRefSchema(node, doc, options);
  return res.isChild || res.isChildList;
}

/**
 * The JSON Schema of a component: a Zod schema through the bridge, or a JSON
 * Schema definition as its own document.
 */
function componentSchemaDoc(schema: unknown, protocolVersion: string | undefined): SchemaCursor {
  if (schema && typeof schema === 'object' && '_def' in schema) {
    // ponytail: bridge until Task 8
    return toSchemaDoc(schema as ComponentApi['schema'], protocolVersion);
  }
  const root = (schema ?? false) as JsonSchema;
  return {node: root, doc: {root, defs: {}}};
}

/**
 * Builds a ComponentRefMap dynamically by inspecting component schemas.
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
  const maybeCatalog = catalogOrComponents as {
    components?: ReadonlyMap<string, T>;
    protocolVersion?: string;
  };
  const componentApis: ReadonlyArray<ComponentApi> =
    typeof maybeCatalog?.components?.values === 'function'
      ? Array.from(maybeCatalog.components.values())
      : Array.isArray(catalogOrComponents)
        ? catalogOrComponents
        : Array.from((catalogOrComponents as ReadonlyMap<string, T>).values());

  for (const compApi of componentApis) {
    const singleRefs = new Set<string>();
    const listRefs = new Set<string>();
    const nestedRefs: Record<string, Set<string>> = {};
    const {node, doc} = componentSchemaDoc(compApi.schema, maybeCatalog?.protocolVersion);
    for (const [key, refKind] of extractRefFields(node, doc, options)) {
      if (refKind.kind === 'single') {
        singleRefs.add(key);
      } else {
        listRefs.add(key);
        if (refKind.kind === 'nested') nestedRefs[key] = new Set(refKind.keys);
      }
    }
    refMap[compApi.name] = {singleRefs, listRefs, nestedRefs};
  }

  return refMap;
}
