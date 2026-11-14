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

import {deref, type SchemaCursor, type SchemaDoc} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';
import {type ChildRefKind, childRefKindForDefName} from '../types/child-ref-helpers.js';

/**
 * Options for configuring child reference analysis.
 */
export interface ChildRefAnalysisOptions {
  /** Set of definition names recognized as single child references. */
  childRefNames: ReadonlySet<string>;
  /** Set of definition names recognized as child list references. */
  childListRefNames: ReadonlySet<string>;
  /** Optional set of string property names recognized as single child references (e.g. in v0.8 schemas without $ref). */
  childPropertyNames?: ReadonlySet<string>;
}

/**
 * Extracts the target definition name from a JSON Schema `$ref` pointer or URI.
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

/**
 * Default definition names in `$ref` targets and `REF:` schema descriptions that
 * denote single-child component IDs or child lists.
 */
const DEFAULT_SINGLE_CHILD_DEF_NAMES: ReadonlySet<string> = new Set([
  'ComponentId',
  'Child',
  'ChildComponentId',
]);
const DEFAULT_CHILD_LIST_DEF_NAMES: ReadonlySet<string> = new Set([
  'ChildList',
  'TemplateChildList',
  'ChildrenItem',
  'TemplateItem',
]);

/**
 * Describes how a component schema property references child components.
 */
export type RefKind =
  | {
      /** The property holds a single child component id. */
      readonly kind: 'single';
    }
  | {
      /** The property holds a `ChildList` (static id array or template). */
      readonly kind: 'list';
    }
  | {
      /**
       * The property holds an array of plain objects in which `keys` are
       * single child references (e.g. a tab strip's `items[].child`).
       */
      readonly kind: 'nested';
      readonly keys: ReadonlySet<string>;
    };

/** Child-referencing properties of a component schema, keyed by property name. */
export type RefFields = ReadonlyMap<string, RefKind>;

const EMPTY_REF_FIELDS: RefFields = new Map();

const DEFAULT_OPTIONS_CACHE_KEY = {};
const refFieldsCache = new WeakMap<object, WeakMap<object, WeakMap<object, RefFields>>>();

type Obj = {[k: string]: unknown};

const isObj = (n: unknown): n is Obj => typeof n === 'object' && n !== null && !Array.isArray(n);

/** Keywords that annotate a schema without constraining its shape. */
const ANNOTATION_KEYS: ReadonlySet<string> = new Set([
  '$comment',
  '$defs',
  '$id',
  '$schema',
  'default',
  'definitions',
  'deprecated',
  'description',
  'examples',
  'markdownDescription',
  'readOnly',
  'title',
  'writeOnly',
]);

const OBJECT_KEYS = [
  'properties',
  'additionalProperties',
  'unevaluatedProperties',
  'patternProperties',
];

/**
 * A schema node unwrapped through `$ref`s and nullable or never-optional
 * combinators, with the descriptions, definition names, and child-ref kinds
 * collected along the way.
 */
interface UnwrappedField {
  readonly node: JsonSchema;
  readonly doc: SchemaDoc;
  readonly descriptions: string[];
  /** Definition names from `REF:` descriptions and `$ref`s into other documents. */
  readonly refDefNames: Set<string>;
  /**
   * Definition names from `$ref`s within the owning document. They mark child
   * references but, like inlined definitions, no other kind of value.
   */
  readonly localDefNames: Set<string>;
  readonly bareDefNames: Set<string>;
  readonly refs: Set<ChildRefKind>;
  readonly traversed: Set<object>;
}

type Kind = 'any' | 'never' | 'object' | 'array' | 'string' | 'union' | 'intersection' | 'other';

function isNever(n: unknown): boolean {
  return n === false || (isObj(n) && isObj(n['not']) && Object.keys(n['not']).length === 0);
}

function isNullOnly(n: unknown): boolean {
  return isObj(n) && n['type'] === 'null';
}

/** Whether `node` has constraining keywords besides `except`. */
function hasStructuralSiblings(node: Obj, except: readonly string[]): boolean {
  return Object.keys(node).some(k => !ANNOTATION_KEYS.has(k) && !except.includes(k));
}

/** The definition name a `$ref` string points at under `$defs`/`definitions`, if any. */
function refDefName(ref: string): string {
  const hash = ref.indexOf('#');
  if (hash === -1) return ref.includes('/') ? '' : ref;
  const fragment = ref.slice(hash + 1);
  if (!fragment.includes('/')) return fragment;
  const m = /(?:^|\/)(?:\$defs|definitions)\/([^/]+)$/.exec(fragment);
  return m ? m[1] : '';
}

/**
 * Removes one nullable or never-optional wrapper: a `null` or `{not: {}}` member of
 * `anyOf`/`oneOf`, `null` in a `type` array, or a lone `allOf` member.
 */
function unwrapOnce(node: Obj): JsonSchema | undefined {
  for (const key of ['anyOf', 'oneOf']) {
    const opts = node[key];
    if (!Array.isArray(opts)) continue;
    const rest = opts.filter(o => !isNullOnly(o) && !isNever(o));
    if (rest.length === opts.length || rest.length === 0) return undefined;
    if (rest.length === 1 && !hasStructuralSiblings(node, [key])) return rest[0] as JsonSchema;
    return {...node, [key]: rest};
  }
  const t = node['type'];
  if (Array.isArray(t) && t.includes('null') && t.length > 1) {
    const rest = t.filter(x => x !== 'null');
    return {...node, type: rest.length === 1 ? rest[0] : rest};
  }
  const allOf = node['allOf'];
  if (Array.isArray(allOf) && allOf.length <= 1 && !hasStructuralSiblings(node, ['allOf'])) {
    return allOf.length === 1 ? (allOf[0] as JsonSchema) : true;
  }
  return undefined;
}

/** The description of a node, looking through one `$ref` when it has none of its own. */
function ownOrTargetDescription(node: unknown, doc: SchemaDoc): unknown {
  if (!isObj(node)) return undefined;
  if (node['description'] !== undefined || typeof node['$ref'] !== 'string') {
    return node['description'];
  }
  try {
    const target = deref(node, doc).node;
    return isObj(target) ? target['description'] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether `desc` on a combinator was copied from its first member, as Zod's
 * `.or()`/`.and()` do and `zod-to-json-schema` writes through.
 */
function isCombinatorInheritedDescription(node: Obj, doc: SchemaDoc, desc: string): boolean {
  const members = node['anyOf'] ?? node['oneOf'] ?? node['allOf'];
  return Array.isArray(members) && ownOrTargetDescription(members[0], doc) === desc;
}

function collectRefDefName(
  description: string,
  refDefNames: Set<string>,
  bareDefNames: Set<string>,
): void {
  if (description.startsWith('REF:')) {
    const defName = extractRefDefName(description.slice(4).split('|')[0]);
    if (defName) refDefNames.add(defName);
    return;
  }
  const refTarget = extractRefDefName(description.split('|')[0]);
  if (refTarget) bareDefNames.add(refTarget);
  const trimmed = description.trim();
  if (trimmed) bareDefNames.add(trimmed);
}

/** Follows `$ref`s and strips nullable wrappers, collecting reference markers. */
function unwrapField(c: SchemaCursor): UnwrappedField {
  const descriptions: string[] = [];
  const refDefNames = new Set<string>();
  const localDefNames = new Set<string>();
  const bareDefNames = new Set<string>();
  const refs = new Set<ChildRefKind>();
  const traversed = new Set<object>();
  const addName = (name: string | undefined, local: boolean) => {
    if (!name) return;
    (local ? localDefNames : refDefNames).add(name);
    const kind = childRefKindForDefName(name);
    if (kind) refs.add(kind);
  };

  let {node, doc} = c;
  while (isObj(node) && !traversed.has(node)) {
    traversed.add(node);
    const desc = node['description'];
    if (typeof desc === 'string' && !isCombinatorInheritedDescription(node, doc, desc)) {
      descriptions.push(desc);
      collectRefDefName(desc, refDefNames, bareDefNames);
    }
    const ref = node['$ref'];
    if (typeof ref === 'string') {
      addName(refDefName(ref), ref.startsWith('#'));
      let target;
      try {
        target = deref(node, doc);
      } catch {
        // Unresolved or cyclic: the reference is opaque beyond its name.
        break;
      }
      addName(target.refName, target.doc.root === doc.root);
      node = target.node;
      doc = target.doc;
      continue;
    }
    const inner = unwrapOnce(node);
    if (inner === undefined) break;
    node = inner;
  }
  return {node, doc, descriptions, refDefNames, localDefNames, bareDefNames, refs, traversed};
}

function kindOf(node: JsonSchema): Kind {
  if (node === true) return 'any';
  if (!isObj(node)) return 'never';
  if (typeof node['$ref'] === 'string') return 'other';
  if (isNever(node)) return 'never';
  if (Array.isArray(node['allOf'])) return 'intersection';
  for (const key of ['anyOf', 'oneOf']) {
    if (Array.isArray(node[key])) {
      return hasStructuralSiblings(node, [key]) ? 'intersection' : 'union';
    }
  }
  let t = node['type'];
  if (Array.isArray(t)) {
    const types = t.filter(x => x !== 'null');
    if (types.length > 1) return 'union';
    if (types.length === 0) return 'other';
    t = types[0];
  }
  if ('enum' in node || 'const' in node) return 'other';
  const items = node['items'];
  if (t === undefined) {
    if (items !== undefined) return Array.isArray(items) ? 'other' : 'array';
    if (OBJECT_KEYS.some(k => k in node)) return 'object';
    return 'any';
  }
  if (t === 'object') return 'object';
  if (t === 'array') return Array.isArray(items) ? 'other' : 'array';
  if (t === 'string') return 'string';
  return 'other';
}

/** The members of a union node: `anyOf`/`oneOf`, or one per entry of a `type` array. */
function unionOptions(field: UnwrappedField): SchemaCursor[] | undefined {
  const node = field.node;
  if (!isObj(node)) return undefined;
  const opts = node['anyOf'] ?? node['oneOf'];
  if (Array.isArray(opts)) return opts.map(o => ({node: o as JsonSchema, doc: field.doc}));
  const t = node['type'];
  if (Array.isArray(t)) {
    const {description: _d, ...rest} = node;
    return t.filter(x => x !== 'null').map(x => ({node: {...rest, type: x}, doc: field.doc}));
  }
  return undefined;
}

/** The members of an intersection: `allOf` entries, after the node's own constraints. */
function intersectionParts(field: UnwrappedField): SchemaCursor[] {
  const node = field.node as Obj;
  const key = Array.isArray(node['allOf'])
    ? 'allOf'
    : Array.isArray(node['anyOf'])
      ? 'anyOf'
      : 'oneOf';
  const {[key]: members, ...rest} = node;
  // `unevaluatedProperties: false` closes only keys no member evaluates, so as
  // a standalone part it would wrongly close the members' keys.
  if (rest['unevaluatedProperties'] === false) delete rest['unevaluatedProperties'];
  const parts: SchemaCursor[] =
    key === 'allOf'
      ? (members as JsonSchema[]).map(m => ({node: m, doc: field.doc}))
      : [{node: {[key]: members}, doc: field.doc}];
  if (hasStructuralSiblings(rest, [])) parts.unshift({node: rest, doc: field.doc});
  return parts;
}

/** Splits intersection parts into a left member and the intersection of the rest. */
function splitParts(parts: SchemaCursor[]): [SchemaCursor, SchemaCursor] {
  const [left, ...others] = parts;
  const right =
    others.length === 1
      ? others[0]
      : {node: {allOf: others.map(p => p.node)}, doc: (others[0] ?? left).doc};
  return [left, right];
}

function arrayElement(field: UnwrappedField): SchemaCursor {
  const items = (field.node as Obj)['items'];
  return {node: items === undefined ? true : (items as JsonSchema), doc: field.doc};
}

function ownPropertyKeys(node: JsonSchema): Set<string> {
  return isObj(node) && isObj(node['properties'])
    ? new Set(Object.keys(node['properties']))
    : new Set();
}

function isTemplateRefField(field: UnwrappedField): boolean {
  if (kindOf(field.node) !== 'object') return false;
  const keys = ownPropertyKeys(field.node);
  return (
    (keys.has('componentId') &&
      (keys.has('path') || keys.has('@path') || keys.has('dataBinding'))) ||
    keys.has('explicitList') ||
    keys.has('template')
  );
}

function alreadyVisited(field: UnwrappedField, visited: Set<object>): boolean {
  for (const s of field.traversed) {
    if (visited.has(s)) return true;
  }
  return false;
}

function withTraversed(visited: Set<object>, field: UnwrappedField): Set<object> {
  const next = new Set(visited);
  for (const s of field.traversed) next.add(s);
  return next;
}

/**
 * Returns whether a schema matches a dynamic child-list template shape
 * (`{ componentId, path | @path | dataBinding }` or v0.8 `explicitList`/`template`).
 *
 * @param node The schema node.
 * @param doc The document that owns `node`.
 */
export function isTemplateRefObject(node: JsonSchema, doc: SchemaDoc): boolean {
  return isTemplateRefField(unwrapField({node, doc}));
}

/**
 * Returns whether a schema can accept a single component ID string on the wire.
 */
export function canSchemaHoldSingleRef(
  node: JsonSchema,
  doc: SchemaDoc,
  options?: ChildRefAnalysisOptions,
): boolean {
  return canHoldSingleRef(unwrapField({node, doc}), new Set(), options);
}

/**
 * Returns whether a schema can accept a child list or template on the wire.
 */
export function canSchemaHoldListRef(
  node: JsonSchema,
  doc: SchemaDoc,
  options?: ChildRefAnalysisOptions,
): boolean {
  return canHoldListRef(unwrapField({node, doc}), new Set(), options);
}

/**
 * Returns whether property `key` with schema `node` classifies as a single-child component reference.
 */
export function isSingleChildPropertySchema(
  key: string,
  node: JsonSchema,
  doc: SchemaDoc,
  options?: ChildRefAnalysisOptions,
): boolean {
  return classifyProperty(key, {node, doc}, new Set(), options)?.kind === 'single';
}

/**
 * Returns whether a schema can accept an object or array value on the wire.
 */
export function canSchemaHoldObjectOrArray(node: JsonSchema, doc: SchemaDoc): boolean {
  const field = unwrapField({node, doc});
  return (
    canHoldObjectElement(field, new Set()) ||
    canHoldNestedRef(field, new Set()) ||
    kindOf(field.node) === 'array'
  );
}

/**
 * Extracts the child-referencing properties and their kinds from a component schema.
 *
 * Recognizes `$ref`s to the `ComponentId`, `Child`, and `ChildList` definitions and
 * `REF:` description pointers, unannotated `child` and `children` properties whose
 * types can hold component references (and v0.8's `explicitList`/`template` children
 * and `childPropertyNames`), and open or empty-property objects (`properties: {}`,
 * `additionalProperties: true` or a schema, `{}`), which may hold `child` and
 * `children`. An object without `additionalProperties` declares nothing about
 * unknown keys; `additionalProperties: false` closes it.
 *
 * @param node Component schema to inspect.
 * @param doc The document that owns `node`.
 * @param options Optional custom child reference analysis options.
 * @returns Map of child-referencing property names to their reference kinds.
 */
export function extractRefFields(
  node: JsonSchema,
  doc: SchemaDoc,
  options?: ChildRefAnalysisOptions,
): RefFields {
  const cacheable = isObj(node) && typeof doc.root === 'object';
  let nodeCache: WeakMap<object, RefFields> | undefined;
  if (cacheable) {
    const cacheKey = options ?? DEFAULT_OPTIONS_CACHE_KEY;
    let byRoot = refFieldsCache.get(cacheKey);
    if (!byRoot) {
      byRoot = new WeakMap();
      refFieldsCache.set(cacheKey, byRoot);
    }
    nodeCache = byRoot.get(doc.root as object);
    if (!nodeCache) {
      nodeCache = new WeakMap();
      byRoot.set(doc.root as object, nodeCache);
    }
    const cached = nodeCache.get(node);
    if (cached) return cached;
  }

  const analysis = analyzeSchema({node, doc}, new Set(), options);
  const fields = analysis.fields;

  if (
    (analysis.isEmptyObject && !analysis.declaredKeys.has('child')) ||
    analysis.openChildFallback
  ) {
    mergeRefKind(fields, 'child', {kind: 'single'});
  }
  if (
    (analysis.isEmptyObject && !analysis.declaredKeys.has('children')) ||
    analysis.openChildrenFallback
  ) {
    mergeRefKind(fields, 'children', {kind: 'list'});
  }

  const result = fields.size === 0 ? EMPTY_REF_FIELDS : fields;
  if (nodeCache && isObj(node)) nodeCache.set(node, result);
  return result;
}

interface SchemaRefAnalysis {
  fields: Map<string, RefKind>;
  declaredKeys: Set<string>;
  compatibleSingleKeys: Set<string>;
  compatibleListKeys: Set<string>;
  compatibleNestedKeys: Set<string>;
  nestedElementAnalyses: Map<string, SchemaRefAnalysis>;
  constrainsUnknownKeys: boolean;
  isEmptyObject: boolean;
  openSingle: boolean;
  openList: boolean;
  openChildFallback: boolean;
  openChildrenFallback: boolean;
}

function emptyAnalysis(): SchemaRefAnalysis {
  return {
    fields: new Map(),
    declaredKeys: new Set(),
    compatibleSingleKeys: new Set(),
    compatibleListKeys: new Set(),
    compatibleNestedKeys: new Set(),
    nestedElementAnalyses: new Map(),
    constrainsUnknownKeys: true,
    isEmptyObject: false,
    openSingle: false,
    openList: false,
    openChildFallback: false,
    openChildrenFallback: false,
  };
}

function openAnalysis(): SchemaRefAnalysis {
  return {
    ...emptyAnalysis(),
    constrainsUnknownKeys: false,
    openSingle: true,
    openList: true,
    openChildFallback: true,
    openChildrenFallback: true,
  };
}

function analyzeObject(
  field: UnwrappedField,
  visited: Set<object>,
  options?: ChildRefAnalysisOptions,
): SchemaRefAnalysis {
  const node = field.node as Obj;
  const shape = isObj(node['properties']) ? node['properties'] : {};
  const fields = new Map<string, RefKind>();
  const declaredKeys = new Set<string>(Object.keys(shape));
  const compatibleSingleKeys = new Set<string>();
  const compatibleListKeys = new Set<string>();
  const compatibleNestedKeys = new Set<string>();
  const nestedElementAnalyses = new Map<string, SchemaRefAnalysis>();

  for (const [key, value] of Object.entries(shape)) {
    const prop: SchemaCursor = {node: value as JsonSchema, doc: field.doc};
    const kind = classifyProperty(key, prop, visited, options);
    if (kind) {
      fields.set(key, kind);
    }
    const propField = unwrapField(prop);
    if (canHoldSingleRef(propField, new Set(visited), options, true)) {
      compatibleSingleKeys.add(key);
    }
    if (canHoldListRef(propField, new Set(visited), options, true)) {
      compatibleListKeys.add(key);
    }
    if (canHoldNestedRef(propField, new Set(visited))) {
      compatibleNestedKeys.add(key);
      const elemAnalysis = extractNestedElementAnalysis(propField, new Set(visited), options);
      if (elemAnalysis) {
        nestedElementAnalyses.set(key, elemAnalysis);
      }
    }
  }

  const extra =
    'additionalProperties' in node ? node['additionalProperties'] : node['unevaluatedProperties'];
  let openSingle = false;
  let openList = false;
  let openChildFallback = false;
  let openChildrenFallback = false;
  let constrainsUnknownKeys = false;
  if (extra === true) {
    openSingle = true;
    openList = true;
    openChildFallback = !declaredKeys.has('child');
    openChildrenFallback = !declaredKeys.has('children');
  } else if (extra !== undefined) {
    constrainsUnknownKeys = true;
    const extraField = unwrapField({node: extra as JsonSchema, doc: field.doc});
    if (kindOf(extraField.node) !== 'never') {
      openSingle = canHoldSingleRef(extraField, new Set(visited), options, true);
      openList = canHoldListRef(extraField, new Set(visited), options, true);
      openChildFallback =
        !declaredKeys.has('child') &&
        canHoldSingleRef(extraField, new Set(visited), options, false);
      openChildrenFallback =
        !declaredKeys.has('children') &&
        canHoldListRef(extraField, new Set(visited), options, false);
    }
  }

  return {
    fields,
    declaredKeys,
    compatibleSingleKeys,
    compatibleListKeys,
    compatibleNestedKeys,
    nestedElementAnalyses,
    constrainsUnknownKeys,
    // Only an object that declares an empty property map is an empty stub; one
    // that declares none (`{type: 'object'}`) is a closed leaf.
    isEmptyObject:
      declaredKeys.size === 0 &&
      isObj(node['properties']) &&
      !constrainsUnknownKeys &&
      !openSingle &&
      !openList,
    openSingle,
    openList,
    openChildFallback,
    openChildrenFallback,
  };
}

function analyzeSchema(
  c: SchemaCursor,
  visited: Set<object>,
  options?: ChildRefAnalysisOptions,
): SchemaRefAnalysis {
  const unwrapped = unwrapField(c);
  if (alreadyVisited(unwrapped, visited)) {
    return emptyAnalysis();
  }
  for (const s of unwrapped.traversed) {
    visited.add(s);
  }

  switch (kindOf(unwrapped.node)) {
    case 'object':
      return analyzeObject(unwrapped, visited, options);
    case 'any':
      return openAnalysis();
    case 'intersection':
      return intersectionParts(unwrapped)
        .map(part => analyzeSchema(part, new Set(visited), options))
        .reduce((left, right) => intersectAnalyses(left, right));
    case 'union': {
      const subs = (unionOptions(unwrapped) ?? []).map(option =>
        analyzeSchema(option, new Set(visited), options),
      );
      return unionAnalyses(subs);
    }
    default:
      return emptyAnalysis();
  }
}

function unionAnalyses(subs: readonly SchemaRefAnalysis[]): SchemaRefAnalysis {
  const fields = new Map<string, RefKind>();
  const declaredKeys = new Set<string>();
  const compatibleSingleKeys = new Set<string>();
  const compatibleListKeys = new Set<string>();
  const compatibleNestedKeys = new Set<string>();
  let allEmpty = subs.length > 0;
  let allConstrainUnknown = subs.length > 0;
  let openSingle = false;
  let openList = false;
  let openChildFallback = false;
  let openChildrenFallback = false;

  for (const sub of subs) {
    for (const [key, kind] of sub.fields) {
      mergeRefKind(fields, key, kind);
    }
    for (const key of sub.declaredKeys) {
      declaredKeys.add(key);
    }
    allEmpty = allEmpty && sub.isEmptyObject;
    allConstrainUnknown = allConstrainUnknown && sub.constrainsUnknownKeys;
    openSingle = openSingle || sub.openSingle;
    openList = openList || sub.openList;
    openChildFallback = openChildFallback || sub.openChildFallback;
    openChildrenFallback = openChildrenFallback || sub.openChildrenFallback;
  }

  for (const key of declaredKeys) {
    if (subs.some(sub => isRefCompatibleWithSide(key, {kind: 'single'}, sub))) {
      compatibleSingleKeys.add(key);
    }
    if (subs.some(sub => isRefCompatibleWithSide(key, {kind: 'list'}, sub))) {
      compatibleListKeys.add(key);
    }
    if (subs.some(sub => isRefCompatibleWithSide(key, {kind: 'nested', keys: new Set()}, sub))) {
      compatibleNestedKeys.add(key);
    }
  }

  return {
    fields,
    declaredKeys,
    compatibleSingleKeys,
    compatibleListKeys,
    compatibleNestedKeys,
    nestedElementAnalyses: new Map(),
    constrainsUnknownKeys: allConstrainUnknown,
    isEmptyObject: allEmpty,
    openSingle,
    openList,
    openChildFallback,
    openChildrenFallback,
  };
}

function intersectAnalyses(left: SchemaRefAnalysis, right: SchemaRefAnalysis): SchemaRefAnalysis {
  const fields = new Map<string, RefKind>();
  for (const [key, kind] of left.fields) {
    mergeCompatibleField(fields, key, kind, left, right);
  }
  for (const [key, kind] of right.fields) {
    mergeCompatibleField(fields, key, kind, right, left);
  }

  const declaredKeys = new Set([...left.declaredKeys, ...right.declaredKeys]);
  const compatibleSingleKeys = new Set<string>();
  const compatibleListKeys = new Set<string>();
  const compatibleNestedKeys = new Set<string>();
  const nestedElementAnalyses = new Map<string, SchemaRefAnalysis>();
  for (const key of declaredKeys) {
    if (
      isRefCompatibleWithSide(key, {kind: 'single'}, left) &&
      isRefCompatibleWithSide(key, {kind: 'single'}, right)
    ) {
      compatibleSingleKeys.add(key);
    }
    if (
      isRefCompatibleWithSide(key, {kind: 'list'}, left) &&
      isRefCompatibleWithSide(key, {kind: 'list'}, right)
    ) {
      compatibleListKeys.add(key);
    }
    if (
      isRefCompatibleWithSide(key, {kind: 'nested', keys: new Set()}, left) &&
      isRefCompatibleWithSide(key, {kind: 'nested', keys: new Set()}, right)
    ) {
      compatibleNestedKeys.add(key);
      const leftElem = left.nestedElementAnalyses.get(key);
      const rightElem = right.nestedElementAnalyses.get(key);
      if (leftElem && rightElem) {
        nestedElementAnalyses.set(key, intersectAnalyses(leftElem, rightElem));
      } else if (leftElem || rightElem) {
        nestedElementAnalyses.set(key, (leftElem ?? rightElem)!);
      }
    }
  }

  const constrainsUnknownKeys = left.constrainsUnknownKeys || right.constrainsUnknownKeys;
  const isEmptyObject = !constrainsUnknownKeys && left.isEmptyObject && right.isEmptyObject;
  const openSingle =
    !isEmptyObject &&
    (left.openSingle || right.openSingle) &&
    (left.openSingle || !left.constrainsUnknownKeys) &&
    (right.openSingle || !right.constrainsUnknownKeys);
  const openList =
    !isEmptyObject &&
    (left.openList || right.openList) &&
    (left.openList || !left.constrainsUnknownKeys) &&
    (right.openList || !right.constrainsUnknownKeys);
  const openChildFallback =
    !isEmptyObject &&
    !declaredKeys.has('child') &&
    (left.openChildFallback || right.openChildFallback) &&
    (left.openChildFallback || !left.constrainsUnknownKeys) &&
    (right.openChildFallback || !right.constrainsUnknownKeys);
  const openChildrenFallback =
    !isEmptyObject &&
    !declaredKeys.has('children') &&
    (left.openChildrenFallback || right.openChildrenFallback) &&
    (left.openChildrenFallback || !left.constrainsUnknownKeys) &&
    (right.openChildrenFallback || !right.constrainsUnknownKeys);

  return {
    fields,
    declaredKeys,
    compatibleSingleKeys,
    compatibleListKeys,
    compatibleNestedKeys,
    nestedElementAnalyses,
    constrainsUnknownKeys,
    isEmptyObject,
    openSingle,
    openList,
    openChildFallback,
    openChildrenFallback,
  };
}

function filterNestedSubKeys(
  keys: ReadonlySet<string>,
  ownElem: SchemaRefAnalysis | undefined,
  otherElem: SchemaRefAnalysis | undefined,
): Set<string> {
  const filteredKeys = new Set<string>();
  for (const subKey of keys) {
    const singleOk =
      (!ownElem || isRefCompatibleWithSide(subKey, {kind: 'single'}, ownElem)) &&
      (!otherElem || isRefCompatibleWithSide(subKey, {kind: 'single'}, otherElem));
    const listOk =
      (!ownElem || isRefCompatibleWithSide(subKey, {kind: 'list'}, ownElem)) &&
      (!otherElem || isRefCompatibleWithSide(subKey, {kind: 'list'}, otherElem));
    if (singleOk || listOk) {
      filteredKeys.add(subKey);
    }
  }
  return filteredKeys;
}

function mergeCompatibleField(
  target: Map<string, RefKind>,
  key: string,
  kind: RefKind,
  source: SchemaRefAnalysis,
  other: SchemaRefAnalysis,
): void {
  if (kind.kind === 'nested') {
    if (!isRefCompatibleWithSide(key, kind, other)) {
      if (
        source.compatibleListKeys.has(key) &&
        isRefCompatibleWithSide(key, {kind: 'list'}, other)
      ) {
        mergeRefKind(target, key, {kind: 'list'});
      } else if (
        source.compatibleSingleKeys.has(key) &&
        isRefCompatibleWithSide(key, {kind: 'single'}, other)
      ) {
        mergeRefKind(target, key, {kind: 'single'});
      }
      return;
    }
    const otherElem = other.nestedElementAnalyses.get(key);
    if (!otherElem) {
      mergeRefKind(target, key, kind);
      return;
    }
    const filteredKeys = filterNestedSubKeys(
      kind.keys,
      source.nestedElementAnalyses.get(key),
      otherElem,
    );
    if (filteredKeys.size > 0) {
      mergeRefKind(target, key, {kind: 'nested', keys: filteredKeys});
    } else if (
      source.compatibleListKeys.has(key) &&
      isRefCompatibleWithSide(key, {kind: 'list'}, other)
    ) {
      mergeRefKind(target, key, {kind: 'list'});
    } else if (
      source.compatibleSingleKeys.has(key) &&
      isRefCompatibleWithSide(key, {kind: 'single'}, other)
    ) {
      mergeRefKind(target, key, {kind: 'single'});
    }
    return;
  }

  if (isRefCompatibleWithSide(key, kind, other)) {
    mergeRefKind(target, key, kind);
    return;
  }

  // Narrowing a `single | list` union (classified as `list`) with a single-only constraint
  // (e.g. `{type: 'string'}`) preserves the single-child reference capability.
  if (
    kind.kind === 'list' &&
    source.compatibleSingleKeys.has(key) &&
    isRefCompatibleWithSide(key, {kind: 'single'}, other)
  ) {
    mergeRefKind(target, key, {kind: 'single'});
  }
}

function isRefCompatibleWithSide(key: string, kind: RefKind, other: SchemaRefAnalysis): boolean {
  if (other.declaredKeys.has(key)) {
    if (kind.kind === 'single') {
      return other.compatibleSingleKeys.has(key);
    }
    if (kind.kind === 'list') {
      return other.compatibleListKeys.has(key);
    }
    return other.compatibleNestedKeys.has(key);
  }
  if (other.constrainsUnknownKeys) {
    if (kind.kind === 'single') {
      return other.openSingle;
    }
    return other.openList;
  }
  return true;
}

function mergeRefKind(target: Map<string, RefKind>, key: string, incoming: RefKind): void {
  const existing = target.get(key);
  if (!existing) {
    target.set(key, incoming);
    return;
  }
  if (
    (existing.kind === 'single' && (incoming.kind === 'list' || incoming.kind === 'nested')) ||
    (existing.kind === 'list' && incoming.kind === 'nested')
  ) {
    target.set(key, incoming);
    return;
  }
  if (existing.kind === 'nested' && incoming.kind === 'nested') {
    target.set(key, {
      kind: 'nested',
      keys: new Set([...existing.keys, ...incoming.keys]),
    });
  }
}

function classifyProperty(
  key: string,
  value: SchemaCursor,
  visited: Set<object>,
  options?: ChildRefAnalysisOptions,
): RefKind | undefined {
  const explicitKind = classifyExplicitProperty(value, visited, options);
  if (explicitKind) {
    return explicitKind;
  }

  // Fallback for unannotated `child` / `children` (and version-specific child property names,
  // such as v0.8's `entryPointChild`) whose types can hold component references.
  const field = unwrapField(value);
  const isSingleChildKey = key === 'child' || Boolean(options?.childPropertyNames?.has(key));
  if (isSingleChildKey && canHoldSingleRef(field, new Set(visited), options)) {
    return {kind: 'single'};
  }
  if (key === 'children' && canHoldListRef(field, new Set(visited), options)) {
    return {kind: 'list'};
  }
  return undefined;
}

function classifyExplicitProperty(
  value: SchemaCursor,
  visited: Set<object>,
  options?: ChildRefAnalysisOptions,
): RefKind | undefined {
  const field = unwrapField(value);
  if (alreadyVisited(field, visited)) {
    return undefined;
  }
  const nextVisited = withTraversed(visited, field);
  const kind = kindOf(field.node);

  // A combinator's description may be copied from one member, so always verify
  // ref compatibility against every member of an intersection.
  if (kind === 'intersection') {
    const [left, right] = splitParts(intersectionParts(field));
    return classifyIntersectedProperty(left, right, nextVisited, options, field);
  }

  // Inspect all union members and merge with any outer marker so `[list, nested]`
  // and `[single, nested]` unions remain order-independent.
  if (kind === 'union') {
    const merged = new Map<string, RefKind>();
    const unionKind = classifyExplicitUnionOptions(unionOptions(field) ?? [], nextVisited, options);
    if (unionKind) {
      mergeRefKind(merged, 'prop', unionKind);
    }
    if (marksChildList(field, options) || isChildListUnion(field)) {
      mergeRefKind(merged, 'prop', {kind: 'list'});
    } else if (marksComponentId(field, options)) {
      mergeRefKind(merged, 'prop', {kind: 'single'});
    }
    return merged.get('prop');
  }

  if (marksChildList(field, options) || isTemplateRefField(field)) {
    return {kind: 'list'};
  }

  if (marksComponentId(field, options)) {
    return {kind: 'single'};
  }

  if (kind === 'array') {
    const element = arrayElement(field);
    const elementAnalysis = analyzeSchema(element, new Set(nextVisited), options);
    const subKeys = new Set<string>();
    for (const [subKey, subKind] of elementAnalysis.fields) {
      if (subKind.kind === 'single' || subKind.kind === 'list') {
        subKeys.add(subKey);
      }
    }
    if (subKeys.size > 0) {
      return {kind: 'nested', keys: subKeys};
    }
    // A plain array of component ids or child lists: classify the element
    // recursively so incompatible intersections (`allOf: [ComponentId, number]`)
    // are handled consistently.
    const elementKind = classifyExplicitProperty(element, nextVisited, options);
    if (elementKind?.kind === 'single' || elementKind?.kind === 'list') {
      return {kind: 'list'};
    }
  }

  return undefined;
}

function extractNestedElementAnalysis(
  field: UnwrappedField,
  visited: Set<object>,
  options?: ChildRefAnalysisOptions,
): SchemaRefAnalysis | undefined {
  if (alreadyVisited(field, visited)) {
    return undefined;
  }
  const nextVisited = withTraversed(visited, field);

  switch (kindOf(field.node)) {
    case 'union': {
      const nestedBranches = (unionOptions(field) ?? [])
        .map(unwrapField)
        .filter(opt => canHoldNestedRef(opt, new Set(nextVisited)));
      if (nestedBranches.length === 0) {
        return emptyAnalysis();
      }
      const branchAnalyses: SchemaRefAnalysis[] = [];
      for (const opt of nestedBranches) {
        const elem = extractNestedElementAnalysis(opt, new Set(nextVisited), options);
        if (!elem) {
          return undefined;
        }
        branchAnalyses.push(elem);
      }
      return unionAnalyses(branchAnalyses);
    }
    case 'any':
      return undefined;
    case 'array':
      return analyzeSchema(arrayElement(field), new Set(nextVisited), options);
    case 'intersection': {
      const elems = intersectionParts(field)
        .map(part => extractNestedElementAnalysis(unwrapField(part), new Set(nextVisited), options))
        .filter((e): e is SchemaRefAnalysis => e !== undefined);
      return elems.length === 0 ? undefined : elems.reduce((l, r) => intersectAnalyses(l, r));
    }
    default:
      return emptyAnalysis();
  }
}

function classifyIntersectedProperty(
  leftRaw: SchemaCursor,
  rightRaw: SchemaCursor,
  visited: Set<object>,
  options: ChildRefAnalysisOptions | undefined,
  outerField: UnwrappedField,
): RefKind | undefined {
  const leftField = unwrapField(leftRaw);
  const rightField = unwrapField(rightRaw);
  const leftKind = classifyExplicitProperty(leftRaw, new Set(visited), options);
  const rightKind = classifyExplicitProperty(rightRaw, new Set(visited), options);
  const merged = new Map<string, RefKind>();

  if (
    marksChildList(outerField, options) &&
    canHoldListRef(leftField, new Set(visited), options, true) &&
    canHoldListRef(rightField, new Set(visited), options, true)
  ) {
    mergeRefKind(merged, 'prop', {kind: 'list'});
  } else if (
    marksComponentId(outerField, options) &&
    canHoldSingleRef(leftField, new Set(visited), options, true) &&
    canHoldSingleRef(rightField, new Set(visited), options, true)
  ) {
    mergeRefKind(merged, 'prop', {kind: 'single'});
  }

  const mergeSide = (
    sideKind: RefKind | undefined,
    ownField: UnwrappedField,
    otherField: UnwrappedField,
  ) => {
    if (!sideKind) return;
    if (canHoldRefKind(sideKind, otherField, new Set(visited), options)) {
      if (sideKind.kind === 'nested') {
        const ownElem = extractNestedElementAnalysis(ownField, new Set(visited), options);
        const otherElem = extractNestedElementAnalysis(otherField, new Set(visited), options);
        const filteredKeys = filterNestedSubKeys(sideKind.keys, ownElem, otherElem);
        if (filteredKeys.size > 0) {
          mergeRefKind(merged, 'prop', {kind: 'nested', keys: filteredKeys});
          return;
        }
      } else {
        mergeRefKind(merged, 'prop', sideKind);
        return;
      }
    }
    if (
      sideKind.kind === 'nested' &&
      canHoldListRef(ownField, new Set(visited), options, true) &&
      canHoldListRef(otherField, new Set(visited), options, true)
    ) {
      mergeRefKind(merged, 'prop', {kind: 'list'});
    } else if (
      (sideKind.kind === 'list' || sideKind.kind === 'nested') &&
      canHoldSingleRef(ownField, new Set(visited), options, true) &&
      canHoldSingleRef(otherField, new Set(visited), options, true)
    ) {
      mergeRefKind(merged, 'prop', {kind: 'single'});
    }
  };

  mergeSide(leftKind, leftField, rightField);
  mergeSide(rightKind, rightField, leftField);

  return merged.get('prop');
}

function canHoldRefKind(
  kind: RefKind,
  field: UnwrappedField,
  visited: Set<object>,
  options?: ChildRefAnalysisOptions,
): boolean {
  if (kind.kind === 'single') {
    return canHoldSingleRef(field, visited, options, true);
  }
  if (kind.kind === 'list') {
    return canHoldListRef(field, visited, options, true);
  }
  return canHoldNestedRef(field, visited);
}

function classifyExplicitUnionOptions(
  unionMembers: readonly SchemaCursor[],
  visited: Set<object>,
  options?: ChildRefAnalysisOptions,
): RefKind | undefined {
  const merged = new Map<string, RefKind>();
  for (const option of unionMembers) {
    const optKind = classifyExplicitProperty(option, new Set(visited), options);
    if (optKind) {
      mergeRefKind(merged, 'prop', optKind);
    }
  }
  return merged.get('prop');
}

function marksComponentId(field: UnwrappedField, options?: ChildRefAnalysisOptions): boolean {
  if (field.refs.has('component-id')) {
    return true;
  }
  const singleNames = options?.childRefNames ?? DEFAULT_SINGLE_CHILD_DEF_NAMES;
  for (const name of singleNames) {
    if (
      field.refDefNames.has(name) ||
      field.localDefNames.has(name) ||
      field.bareDefNames.has(name)
    ) {
      return true;
    }
  }
  return false;
}

function marksChildList(field: UnwrappedField, options?: ChildRefAnalysisOptions): boolean {
  if (field.refs.has('child-list')) {
    return true;
  }
  const listNames = options?.childListRefNames ?? DEFAULT_CHILD_LIST_DEF_NAMES;
  for (const name of listNames) {
    if (
      field.refDefNames.has(name) ||
      field.localDefNames.has(name) ||
      field.bareDefNames.has(name)
    ) {
      return true;
    }
  }
  return false;
}

function hasNonChildRefMarker(field: UnwrappedField, options?: ChildRefAnalysisOptions): boolean {
  if (field.refDefNames.size === 0) {
    return false;
  }
  return !marksComponentId(field, options) && !marksChildList(field, options);
}

function isDynamicBindingObject(field: UnwrappedField): boolean {
  if (kindOf(field.node) !== 'object' || isTemplateRefField(field)) {
    return false;
  }
  const keys = ownPropertyKeys(field.node);
  return keys.has('path') || keys.has('@path') || keys.has('call') || keys.has('@call');
}

function isDynamicValueUnion(
  unionMembers: readonly SchemaCursor[],
  options?: ChildRefAnalysisOptions,
): boolean {
  let hasExplicitChildMarker = false;
  let hasDynamicBranch = false;
  const visited = new Set<object>();

  const visit = (opts: readonly SchemaCursor[]): void => {
    for (const opt of opts) {
      const unwrapped = unwrapField(opt);
      if (alreadyVisited(unwrapped, visited)) {
        continue;
      }
      for (const s of unwrapped.traversed) {
        visited.add(s);
      }

      if (marksComponentId(unwrapped, options) || marksChildList(unwrapped, options)) {
        hasExplicitChildMarker = true;
        return;
      }
      if (hasNonChildRefMarker(unwrapped, options) || isDynamicBindingObject(unwrapped)) {
        hasDynamicBranch = true;
      }
      if (kindOf(unwrapped.node) === 'union') {
        visit(unionOptions(unwrapped) ?? []);
        if (hasExplicitChildMarker) {
          return;
        }
      }
    }
  };

  visit(unionMembers);
  return hasDynamicBranch && !hasExplicitChildMarker;
}

function canHoldSingleRef(
  field: UnwrappedField,
  visited = new Set<object>(),
  options?: ChildRefAnalysisOptions,
  allowDynamicValue = false,
): boolean {
  if (alreadyVisited(field, visited)) {
    return false;
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  const kind = kindOf(field.node);
  if (kind === 'intersection') {
    return intersectionParts(field).every(part =>
      canHoldSingleRef(unwrapField(part), new Set(visited), options, allowDynamicValue),
    );
  }

  if (marksComponentId(field, options)) {
    return true;
  }
  if (!allowDynamicValue && hasNonChildRefMarker(field, options)) {
    return false;
  }

  if (kind === 'union') {
    const members = unionOptions(field) ?? [];
    if (!allowDynamicValue && isDynamicValueUnion(members, options)) {
      return false;
    }
    return members.some(option =>
      canHoldSingleRef(unwrapField(option), new Set(visited), options, allowDynamicValue),
    );
  }

  if (marksChildList(field, options)) {
    return false;
  }

  return kind === 'string' || kind === 'any';
}

function canHoldListRef(
  field: UnwrappedField,
  visited = new Set<object>(),
  options?: ChildRefAnalysisOptions,
  allowDynamicValue = false,
): boolean {
  if (alreadyVisited(field, visited)) {
    return false;
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  const kind = kindOf(field.node);
  if (kind === 'intersection') {
    return intersectionParts(field).every(part =>
      canHoldListRef(unwrapField(part), new Set(visited), options, allowDynamicValue),
    );
  }

  if (marksChildList(field, options) || isChildListUnion(field)) {
    return true;
  }
  if (!allowDynamicValue && hasNonChildRefMarker(field, options)) {
    return false;
  }

  if (kind === 'union') {
    const members = unionOptions(field) ?? [];
    if (!allowDynamicValue && isDynamicValueUnion(members, options)) {
      return false;
    }
    return members.some(option =>
      canHoldListRef(unwrapField(option), new Set(visited), options, allowDynamicValue),
    );
  }

  if (marksComponentId(field, options)) {
    return false;
  }

  switch (kind) {
    case 'any':
      return true;
    case 'array': {
      const element = unwrapField(arrayElement(field));
      return (
        canHoldSingleRef(element, new Set(visited), options, allowDynamicValue) ||
        isTemplateRefField(element)
      );
    }
    case 'object':
      return isTemplateRefField(field);
    default:
      return false;
  }
}

function canHoldNestedRef(field: UnwrappedField, visited = new Set<object>()): boolean {
  if (alreadyVisited(field, visited)) {
    return false;
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  switch (kindOf(field.node)) {
    case 'union':
      return (unionOptions(field) ?? []).some(option =>
        canHoldNestedRef(unwrapField(option), new Set(visited)),
      );
    case 'any':
      return true;
    case 'array':
      return canHoldObjectElement(unwrapField(arrayElement(field)), new Set(visited));
    case 'intersection':
      return intersectionParts(field).every(part =>
        canHoldNestedRef(unwrapField(part), new Set(visited)),
      );
    default:
      return false;
  }
}

function canHoldObjectElement(field: UnwrappedField, visited: Set<object>): boolean {
  if (alreadyVisited(field, visited)) {
    return false;
  }
  for (const s of field.traversed) {
    visited.add(s);
  }

  switch (kindOf(field.node)) {
    case 'union':
      return (unionOptions(field) ?? []).some(option =>
        canHoldObjectElement(unwrapField(option), new Set(visited)),
      );
    case 'object':
    case 'any':
      return true;
    case 'intersection':
      return intersectionParts(field).every(part =>
        canHoldObjectElement(unwrapField(part), new Set(visited)),
      );
    default:
      return false;
  }
}

/** Matches the binder's STRUCTURAL detection for `ChildList`-shaped unions. */
function isChildListUnion(field: UnwrappedField, visited = new Set<object>()): boolean {
  if (kindOf(field.node) !== 'union') {
    return false;
  }
  for (const o of unionOptions(field) ?? []) {
    const unwrapped = unwrapField(o);
    if (alreadyVisited(unwrapped, visited)) {
      continue;
    }
    if (isTemplateRefField(unwrapped)) {
      return true;
    }
    if (isChildListUnion(unwrapped, withTraversed(visited, unwrapped))) {
      return true;
    }
  }
  return false;
}

/**
 * Discovery primitives shared with the catalog reference map.
 *
 * @internal
 */
export const schemaDiscovery = {
  unwrap: unwrapField,
  kindOf,
  unionOptions,
  /** An intersection as a left member and the intersection of the rest. */
  intersectionSides: (field: UnwrappedField) => splitParts(intersectionParts(field)),
  arrayElement,
  isTemplateRef: isTemplateRefField,
};

export type {UnwrappedField as UnwrappedSchemaField};
