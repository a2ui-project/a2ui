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

import type {
  CatalogModel,
  ComponentDefinition,
  DataTypeDefinition,
  FunctionDefinition,
  TypeDefinition,
} from './catalog_model.js';

/** Runtime behavior node consumed by `GenericBinder` and `NodeResolver`. */
export type ModelBehaviorNode =
  | {type: 'DYNAMIC'; isBoolean?: boolean}
  | {type: 'ACTION'}
  | {type: 'STRUCTURAL'}
  | {type: 'CHECKABLE'}
  | {type: 'STATIC'}
  | {type: 'OBJECT'; shape: Record<string, ModelBehaviorNode>; catchall?: ModelBehaviorNode}
  | {type: 'ARRAY'; element: ModelBehaviorNode; templateFallback?: boolean};

/** Child-reference classification for a single component property. */
export type ModelRefKind =
  | {readonly kind: 'single'}
  | {readonly kind: 'list'}
  | {readonly kind: 'nested'; readonly keys: ReadonlySet<string>};

/** Map of component property names to their child-reference kinds. */
export type ModelRefFields = ReadonlyMap<string, ModelRefKind>;

/** Child-reference summary for one component in a `ComponentRefMap`. */
export interface ModelComponentChildRefs {
  readonly singleRefs: ReadonlySet<string>;
  readonly listRefs: ReadonlySet<string>;
  readonly nestedRefs?: Readonly<Record<string, ReadonlySet<string>>>;
}

/** Map of component type names to child-reference summaries. */
export type ModelComponentRefMap = Record<string, ModelComponentChildRefs>;

/** Bare names of the four protocol component envelope mixins. */
export type ModelEnvelopeMixinKey = 'metadata' | 'catalogId' | 'accessibility' | 'checks';

const MODEL_ENVELOPE_MIXIN_KEYS: readonly ModelEnvelopeMixinKey[] = [
  'metadata',
  'catalogId',
  'accessibility',
  'checks',
];

/** Envelope mixin layout derived directly from a canonical {@link ComponentDefinition}. */
export interface ModelEnvelopeLayout {
  readonly customKeys: ReadonlySet<ModelEnvelopeMixinKey>;
  readonly schemaKeys: ReadonlyMap<ModelEnvelopeMixinKey, string>;
}

const ACCESSIBILITY_BEHAVIOR: ModelBehaviorNode = Object.freeze({
  type: 'OBJECT',
  shape: Object.freeze({
    label: Object.freeze({type: 'DYNAMIC'}),
    description: Object.freeze({type: 'DYNAMIC'}),
    live: Object.freeze({type: 'STATIC'}),
    hidden: Object.freeze({type: 'DYNAMIC', isBoolean: true}),
  }),
});

function resolveRef(
  typeDef: TypeDefinition,
  types: Readonly<Record<string, DataTypeDefinition>> | undefined,
  visited: Set<string>,
): TypeDefinition {
  let current: TypeDefinition = typeDef;
  while (current.type === 'ref') {
    if (visited.has(current.ref)) return {type: 'any'};
    const target = types?.[current.ref];
    if (!target) return {type: 'any'};
    visited.add(current.ref);
    current = target;
  }
  return current;
}

function hasActiveBehavior(node: ModelBehaviorNode): boolean {
  switch (node.type) {
    case 'STATIC':
      return false;
    case 'DYNAMIC':
    case 'ACTION':
    case 'STRUCTURAL':
    case 'CHECKABLE':
      return true;
    case 'ARRAY':
      return Boolean(node.templateFallback) || hasActiveBehavior(node.element);
    case 'OBJECT':
      return (
        (node.catchall !== undefined && hasActiveBehavior(node.catchall)) ||
        Object.values(node.shape).some(hasActiveBehavior)
      );
  }
}

function typeToBehavior(
  typeDef: TypeDefinition,
  types: Readonly<Record<string, DataTypeDefinition>> | undefined,
  visited: Set<string>,
): ModelBehaviorNode {
  const resolved = resolveRef(typeDef, types, new Set(visited));
  switch (resolved.type) {
    case 'child':
      return {type: 'STATIC'};
    case 'childList':
      return {type: 'STRUCTURAL'};
    case 'action':
      return {type: 'ACTION'};
    case 'accessibility':
      return ACCESSIBILITY_BEHAVIOR;
    case 'checkRule':
      return {type: 'STATIC'};
    case 'dataBinding':
    case 'functionCall':
      return {type: 'DYNAMIC'};
    case 'boolean':
      return resolved.dynamic ? {type: 'DYNAMIC', isBoolean: true} : {type: 'STATIC'};
    case 'string':
    case 'number':
    case 'integer':
    case 'enum':
    case 'any':
      return resolved.dynamic ? {type: 'DYNAMIC'} : {type: 'STATIC'};
    case 'const':
    case 'rawJsonSchema':
      return {type: 'STATIC'};
    case 'array': {
      if (resolved.dynamic) return {type: 'DYNAMIC'};
      if (!resolved.items) return {type: 'ARRAY', element: {type: 'STATIC'}};
      const itemResolved = resolveRef(resolved.items, types, new Set(visited));
      if (itemResolved.type === 'child') return {type: 'STRUCTURAL'};
      if (itemResolved.type === 'checkRule') return {type: 'CHECKABLE'};
      return {type: 'ARRAY', element: typeToBehavior(itemResolved, types, visited)};
    }
    case 'object': {
      if (resolved.dynamic) return {type: 'DYNAMIC'};
      const shape: Record<string, ModelBehaviorNode> = {};
      for (const prop of resolved.properties ?? []) {
        shape[prop.name] = typeToBehavior(prop, types, visited);
      }
      const catchall =
        resolved.additionalProperties && typeof resolved.additionalProperties === 'object'
          ? typeToBehavior(resolved.additionalProperties, types, visited)
          : undefined;
      return catchall && catchall.type !== 'STATIC'
        ? {type: 'OBJECT', shape, catchall}
        : {type: 'OBJECT', shape};
    }
    case 'union': {
      if (resolved.dynamic) return {type: 'DYNAMIC'};
      const variants = resolved.variants.map(v => resolveRef(v, types, new Set(visited)));
      if (variants.some(v => v.type === 'action')) return {type: 'ACTION'};
      const hasDynamicVariant = variants.some(
        v =>
          v.type === 'dataBinding' ||
          v.type === 'functionCall' ||
          ('dynamic' in v && v.dynamic === true),
      );
      if (hasDynamicVariant) {
        const allBoolean = variants.every(
          v => v.type === 'boolean' || v.type === 'dataBinding' || v.type === 'functionCall',
        );
        const hasBoolean = variants.some(v => v.type === 'boolean');
        return allBoolean && hasBoolean ? {type: 'DYNAMIC', isBoolean: true} : {type: 'DYNAMIC'};
      }
      if (variants.some(v => v.type === 'childList')) {
        const arrayVariant = variants.find(v => v.type === 'array');
        if (arrayVariant && arrayVariant.type === 'array' && arrayVariant.items) {
          const elem = typeToBehavior(arrayVariant.items, types, visited);
          if (hasActiveBehavior(elem)) {
            return {type: 'ARRAY', element: elem, templateFallback: true};
          }
        }
        return {type: 'STRUCTURAL'};
      }
      const objectBehaviors = variants
        .map(v => typeToBehavior(v, types, visited))
        .filter((b): b is Extract<ModelBehaviorNode, {type: 'OBJECT'}> => b.type === 'OBJECT');
      if (objectBehaviors.length > 0) {
        const mergedShape: Record<string, ModelBehaviorNode> = {};
        for (const obj of objectBehaviors) {
          for (const [k, v] of Object.entries(obj.shape)) {
            if (!Object.hasOwn(mergedShape, k) || mergedShape[k].type === 'STATIC') {
              mergedShape[k] = v;
            }
          }
        }
        return {type: 'OBJECT', shape: mergedShape};
      }
      return {type: 'STATIC'};
    }
    default:
      return {type: 'STATIC'};
  }
}

/**
 * Directly maps a canonical {@link ComponentDefinition} to a `GenericBinder`
 * {@link ModelBehaviorNode} tree in O(parameters), without scraping Zod or JSON Schema.
 */
export function definitionToBehavior(
  def: ComponentDefinition,
  types?: Readonly<Record<string, DataTypeDefinition>>,
): ModelBehaviorNode {
  const shape: Record<string, ModelBehaviorNode> = {};
  const visited = new Set<string>();
  for (const param of def.parameters ?? []) {
    shape[param.name] = typeToBehavior(param, types, visited);
  }
  if (!Object.hasOwn(shape, 'accessibility')) {
    shape['accessibility'] = ACCESSIBILITY_BEHAVIOR;
  }
  shape['@accessibility'] = ACCESSIBILITY_BEHAVIOR;
  shape['@checks'] = {type: 'CHECKABLE'};
  if (def.checkable && !Object.hasOwn(shape, 'checks')) {
    shape['checks'] = {type: 'CHECKABLE'};
  }
  return {type: 'OBJECT', shape};
}

function classifyTypeRefKind(
  typeDef: TypeDefinition,
  types: Readonly<Record<string, DataTypeDefinition>> | undefined,
  visited: Set<string>,
): ModelRefKind | undefined {
  const resolved = resolveRef(typeDef, types, new Set(visited));
  switch (resolved.type) {
    case 'child':
      return {kind: 'single'};
    case 'childList':
      return {kind: 'list'};
    case 'array': {
      if (!resolved.items) return undefined;
      const itemResolved = resolveRef(resolved.items, types, new Set(visited));
      if (itemResolved.type === 'child' || itemResolved.type === 'childList') {
        return {kind: 'list'};
      }
      if (itemResolved.type === 'object' && itemResolved.properties) {
        const nestedKeys = new Set<string>();
        for (const subProp of itemResolved.properties) {
          const subKind = classifyTypeRefKind(subProp, types, visited);
          if (subKind) {
            nestedKeys.add(subProp.name);
          }
        }
        if (nestedKeys.size > 0) {
          return {kind: 'nested', keys: nestedKeys};
        }
      }
      return undefined;
    }
    case 'union': {
      let sawSingle = false;
      const nestedKeys = new Set<string>();
      for (const variant of resolved.variants) {
        const k = classifyTypeRefKind(variant, types, visited);
        if (!k) continue;
        if (k.kind === 'list') return {kind: 'list'};
        if (k.kind === 'nested') {
          for (const sub of k.keys) nestedKeys.add(sub);
        } else if (k.kind === 'single') {
          sawSingle = true;
        }
      }
      if (nestedKeys.size > 0) return {kind: 'nested', keys: nestedKeys};
      if (sawSingle) return {kind: 'single'};
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Extracts child-component reference fields directly from a canonical
 * {@link ComponentDefinition} without scraping Zod ASTs or JSON Schema.
 */
export function extractDefinitionRefFields(
  def: ComponentDefinition,
  types?: Readonly<Record<string, DataTypeDefinition>>,
): ModelRefFields {
  const refs = new Map<string, ModelRefKind>();
  const visited = new Set<string>();
  for (const param of def.parameters ?? []) {
    const kind = classifyTypeRefKind(param, types, visited);
    if (kind) {
      refs.set(param.name, kind);
    }
  }
  return refs;
}

/**
 * Builds a {@link ModelComponentRefMap} directly from a {@link CatalogModel}
 * or list of canonical {@link ComponentDefinition}s.
 */
export function buildModelReferenceMap(
  modelOrDefs: CatalogModel | readonly ComponentDefinition[],
  types?: Readonly<Record<string, DataTypeDefinition>>,
): ModelComponentRefMap {
  const isArray = Array.isArray(modelOrDefs);
  const defs: readonly ComponentDefinition[] = isArray
    ? modelOrDefs
    : ((modelOrDefs as CatalogModel).components ?? []);
  const resolvedTypes = isArray ? types : (types ?? (modelOrDefs as CatalogModel).types);
  const map: ModelComponentRefMap = {};
  for (const def of defs) {
    const singleRefs = new Set<string>();
    const listRefs = new Set<string>();
    const nestedRefs: Record<string, Set<string>> = {};
    for (const [key, refKind] of extractDefinitionRefFields(def, resolvedTypes)) {
      if (refKind.kind === 'single') {
        singleRefs.add(key);
      } else if (refKind.kind === 'list') {
        listRefs.add(key);
      } else {
        listRefs.add(key);
        nestedRefs[key] = new Set(refKind.keys);
      }
    }
    map[def.name] = {singleRefs, listRefs, nestedRefs};
  }
  return map;
}

/**
 * Computes a component's envelope mixin layout directly from a canonical
 * {@link ComponentDefinition} (custom parameter keys vs standard `checkable`).
 */
export function definitionEnvelopeLayout(def: ComponentDefinition): ModelEnvelopeLayout {
  const declared = new Set((def.parameters ?? []).map(p => p.name));
  const customKeys = new Set<ModelEnvelopeMixinKey>();
  const schemaKeys = new Map<ModelEnvelopeMixinKey, string>();
  for (const key of MODEL_ENVELOPE_MIXIN_KEYS) {
    if (declared.has(key)) {
      customKeys.add(key);
    }
  }
  if (def.checkable) {
    schemaKeys.set('checks', '@checks');
  }
  return {customKeys, schemaKeys};
}

function containsDynamicBoolean(
  typeDef: TypeDefinition,
  types: Readonly<Record<string, DataTypeDefinition>> | undefined,
  visited: Set<string>,
): boolean {
  const resolved = resolveRef(typeDef, types, new Set(visited));
  if (resolved.type === 'boolean' && resolved.dynamic) {
    return true;
  }
  if (resolved.type === 'array' && resolved.items) {
    return containsDynamicBoolean(resolved.items, types, visited);
  }
  if (resolved.type === 'object' && resolved.properties) {
    return resolved.properties.some(p => containsDynamicBoolean(p, types, visited));
  }
  if (resolved.type === 'union') {
    return resolved.variants.some(v => containsDynamicBoolean(v, types, visited));
  }
  return false;
}

/**
 * Returns the parameter names of a canonical {@link FunctionDefinition} whose
 * type is (or contains) a dynamic boolean (`type: 'boolean', dynamic: true`).
 */
export function findDynamicBooleanParamNames(
  def: FunctionDefinition,
  types?: Readonly<Record<string, DataTypeDefinition>>,
): ReadonlySet<string> {
  const names = new Set<string>();
  const visited = new Set<string>();
  for (const param of def.parameters ?? []) {
    if (containsDynamicBoolean(param, types, visited)) {
      names.add(param.name);
    }
  }
  return names;
}

/**
 * Returns the allowed pre-1.0 `FunctionCall.returnType` values for a canonical
 * {@link TypeDefinition} slot, or `undefined` if unconstrained.
 */
export function allowedReturnTypesForDefinition(
  typeDef: TypeDefinition | undefined,
  types?: Readonly<Record<string, DataTypeDefinition>>,
): ReadonlySet<string> | undefined {
  if (!typeDef) return undefined;
  const resolved = resolveRef(typeDef, types, new Set());
  switch (resolved.type) {
    case 'string':
      return resolved.dynamic ? new Set(['string']) : undefined;
    case 'number':
    case 'integer':
      return resolved.dynamic ? new Set(['number']) : undefined;
    case 'boolean':
      return resolved.dynamic ? new Set(['boolean']) : undefined;
    case 'array':
      return resolved.dynamic ? new Set(['array']) : undefined;
    case 'object':
      return resolved.dynamic ? new Set(['object']) : undefined;
    case 'enum':
      return resolved.dynamic && resolved.valueType ? new Set([resolved.valueType]) : undefined;
    case 'any':
      return undefined;
    case 'union': {
      const allowed = new Set<string>();
      for (const variant of resolved.variants) {
        const sub = resolveRef(variant, types, new Set());
        if (sub.type === 'any') return undefined;
        const subAllowed = allowedReturnTypesForDefinition(sub, types);
        if (subAllowed) {
          for (const t of subAllowed) allowed.add(t);
        }
      }
      return allowed.size > 0 ? allowed : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Returns the declared parameter names of a canonical {@link FunctionDefinition},
 * or `null` when `additionalParameters` allows arbitrary keys.
 */
export function getFunctionDefinitionParameterNames(def: FunctionDefinition): Set<string> | null {
  if (def.additionalParameters !== undefined && def.additionalParameters !== false) {
    return null;
  }
  return new Set((def.parameters ?? []).map(p => p.name));
}
