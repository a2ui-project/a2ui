/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {zodToJsonSchema} from 'zod-to-json-schema';
import type {z} from 'zod';

import {isAtLeastVersion, toCanonicalVersion} from '../common/semver.js';
import type {ComponentApi, FunctionApi} from './types.js';

/** Names of the synthetic union definitions a catalog document carries in `$defs`. */
const UNION_DEF_NAMES = new Set(['anyComponent', 'anyFunction']);

/** Top-level catalog document keys that `serializeCatalogDocument` emits itself. */
const KNOWN_DOCUMENT_KEYS = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'protocolVersion',
  'catalogId',
  'instructions',
  'components',
  'functions',
  '$defs',
]);

/**
 * The catalog state that `serializeCatalogDocument` reads.
 *
 * A structural subset of `Catalog`, so the serializer does not depend on the
 * class itself.
 */
export interface SerializableCatalog {
  readonly id: string;
  readonly protocolVersion: string;
  readonly components: ReadonlyMap<string, ComponentApi>;
  readonly functions: ReadonlyMap<string, FunctionApi>;
  readonly themeSchema?: z.ZodTypeAny;
  readonly instructions?: string;
  readonly schemaUri?: string;
  readonly schemaId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly declaredProtocolVersion?: string;
  readonly defs?: Readonly<Record<string, unknown>>;
  readonly sourceDocument?: Readonly<Record<string, unknown>>;
}

type JsonObject = Record<string, unknown>;

/**
 * Returns a deep copy of a JSON value.
 *
 * @param value JSON-compatible value to copy.
 * @returns A structurally equal copy that shares no objects with `value`.
 */
export function deepCopyJson<V>(value: V): V {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as V;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Collects the names of local `#/$defs/<name>` definitions referenced by a node.
 */
function collectLocalDefRefs(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectLocalDefRefs(item, found);
    return;
  }
  if (!isObject(node)) return;
  const ref = node.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
    const name = ref.slice('#/$defs/'.length).split('/')[0].replace(/~1/g, '/').replace(/~0/g, '~');
    found.add(name);
  }
  for (const value of Object.values(node)) collectLocalDefRefs(value, found);
}

/**
 * Returns the definitions in `defs` reachable from `roots` through local references.
 */
function reachableDefs(roots: unknown[], defs: JsonObject): Set<string> {
  const reached = new Set<string>();
  const pending = new Set<string>();
  for (const root of roots) collectLocalDefRefs(root, pending);
  while (pending.size > 0) {
    const [name] = pending;
    pending.delete(name);
    if (reached.has(name)) continue;
    reached.add(name);
    if (name in defs) {
      const next = new Set<string>();
      collectLocalDefRefs(defs[name], next);
      for (const n of next) if (!reached.has(n)) pending.add(n);
    }
  }
  return reached;
}

/**
 * Returns the entry names a catalog document loads from one of its sections.
 *
 * Mirrors the loader: when the matching union lists `oneOf` references, only the
 * listed names are loaded.
 */
function sourceEntryNames(
  document: Readonly<JsonObject>,
  section: 'components' | 'functions',
): Set<string> {
  const raw = document[section];
  const names = Array.isArray(raw)
    ? raw
        .filter((fn): fn is JsonObject => isObject(fn) && typeof fn.name === 'string')
        .map(fn => fn.name as string)
    : isObject(raw)
      ? Object.keys(raw)
      : [];
  const defs = isObject(document.$defs) ? document.$defs : undefined;
  const union = defs?.[section === 'components' ? 'anyComponent' : 'anyFunction'];
  const oneOf = isObject(union) ? union.oneOf : undefined;
  if (!Array.isArray(oneOf)) return new Set(names);
  const prefix = `#/${section}/`;
  const permitted = new Set(
    oneOf
      .map(item => (isObject(item) && typeof item.$ref === 'string' ? item.$ref : ''))
      .filter(ref => ref.startsWith(prefix))
      .map(ref => ref.slice(prefix.length).replace(/~1/g, '/').replace(/~0/g, '~')),
  );
  return new Set(names.filter(n => permitted.has(n)));
}

function sameNames(a: Iterable<string>, b: Set<string>): boolean {
  const left = new Set(a);
  if (left.size !== b.size) return false;
  for (const name of left) if (!b.has(name)) return false;
  return true;
}

/**
 * Rewrites `REF:<ref>|<description>` markers left by the loader and by
 * code-defined schemas into `$ref` nodes, keeping common types references
 * external (`common_types.json#/$defs/<name>`).
 *
 * @param node Schema node to rewrite in place.
 * @param localDefs Names of authored definitions that stay local references.
 */
function rewriteRefMarkers(node: unknown, localDefs: ReadonlySet<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefMarkers(item, localDefs);
    return;
  }
  if (!isObject(node)) return;

  if (typeof node.description === 'string' && node.description.startsWith('REF:')) {
    const content = node.description.substring(4);
    const pipeIndex = content.indexOf('|');
    const ref = pipeIndex === -1 ? content : content.substring(0, pipeIndex);
    const desc = pipeIndex === -1 ? '' : content.substring(pipeIndex + 1);
    const savedDefault = node.default;
    for (const key of Object.keys(node)) delete node[key];
    const defName = ref.split(/#\/(?:\$defs|definitions)\//)[1]?.split('/')[0];
    node.$ref =
      defName === undefined
        ? ref
        : ref.startsWith('#') && localDefs.has(defName)
          ? ref
          : `common_types.json#/$defs/${defName}`;
    if (savedDefault !== undefined) node.default = savedDefault;
    if (desc) node.description = desc;
    return;
  }

  if (Array.isArray(node.anyOf)) {
    node.oneOf = node.anyOf;
    delete node.anyOf;
  }
  for (const key of ['additionalProperties', 'unevaluatedProperties']) {
    const value = node[key];
    if (isObject(value) && Object.keys(value).length === 0) node[key] = true;
  }
  delete node.$schema;
  for (const value of Object.values(node)) rewriteRefMarkers(value, localDefs);
}

/**
 * Converts a Zod schema into an unbundled JSON Schema object.
 */
function zodToUnbundledJson(
  schema: z.ZodTypeAny | undefined,
  localDefs: ReadonlySet<string>,
): JsonObject {
  if (!schema || typeof schema !== 'object' || !('safeParse' in schema)) {
    return {type: 'object', properties: {}};
  }
  const json = zodToJsonSchema(schema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
  }) as JsonObject;
  delete json.definitions;
  delete json.$defs;
  rewriteRefMarkers(json, localDefs);
  return json;
}

/**
 * Moves an object schema's `additionalProperties` to `unevaluatedProperties`,
 * defaulting to `false`.
 */
function closeObjectSchema(json: JsonObject): void {
  if (json.type !== 'object') return;
  const extra = json.unevaluatedProperties ?? json.additionalProperties;
  delete json.additionalProperties;
  json.unevaluatedProperties =
    typeof extra === 'boolean' || isObject(extra) ? extra : (false as unknown);
}

/**
 * Serializes a component from its model, as an authored catalog entry.
 */
function serializeComponentModel(
  name: string,
  comp: ComponentApi,
  localDefs: ReadonlySet<string>,
): JsonObject {
  const json = zodToUnbundledJson(comp.schema, localDefs);
  const {
    component: _component,
    id: _id,
    ...props
  } = (isObject(json.properties) ? json.properties : {}) as JsonObject;
  const required = Array.isArray(json.required)
    ? (json.required as string[]).filter(r => r !== 'component' && r !== 'id')
    : [];
  const extra = json.unevaluatedProperties ?? json.additionalProperties;
  const result: JsonObject = {
    type: 'object',
    properties: {component: {const: name}, ...props},
    required: ['component', ...required],
    unevaluatedProperties: typeof extra === 'boolean' || isObject(extra) ? extra : false,
  };
  if (comp.allowedParents && comp.allowedParents.length > 0) {
    result.allowedParents = [...comp.allowedParents];
  }
  if (comp.allowedChildren && comp.allowedChildren.length > 0) {
    result.allowedChildren = [...comp.allowedChildren];
  }
  return result;
}

/**
 * Serializes a function from its model, in the call shape of the catalog's
 * protocol version (`@call` from v1.0, `call` before), or as a list item.
 */
function serializeFunctionModel(
  name: string,
  fn: FunctionApi,
  localDefs: ReadonlySet<string>,
  isAtLeastV10: boolean,
  asListItem: boolean,
): JsonObject {
  const args = zodToUnbundledJson(fn.schema, localDefs);
  if (asListItem) {
    return {
      name,
      ...(fn.description ? {description: fn.description} : {}),
      returnType: fn.returnType,
      parameters: args,
      ...(fn.allowedCallers ? {allowedCallers: fn.allowedCallers} : {}),
      ...(fn.requiresUserActivation !== undefined
        ? {requiresUserActivation: fn.requiresUserActivation}
        : {}),
    };
  }
  closeObjectSchema(args);
  const result: JsonObject = {type: 'object'};
  if (fn.description) result.description = fn.description;
  if (isAtLeastV10) {
    result.returnType = fn.returnType;
    if (fn.allowedCallers) result.allowedCallers = fn.allowedCallers;
    if (fn.requiresUserActivation !== undefined) {
      result.requiresUserActivation = fn.requiresUserActivation;
    }
    result.properties = {'@call': {const: name}, args};
    result.required = ['@call', 'args'];
    return result;
  }
  if (fn.allowedCallers) result.allowedCallers = fn.allowedCallers;
  if (fn.requiresUserActivation !== undefined) {
    result.requiresUserActivation = fn.requiresUserActivation;
  }
  result.properties = {call: {const: name}, args, returnType: {const: fn.returnType}};
  result.required = ['call', 'args'];
  result.unevaluatedProperties = false;
  return result;
}

/**
 * Serializes a theme Zod schema into a `$defs.theme` object schema.
 */
function serializeThemeModel(theme: z.ZodTypeAny, localDefs: ReadonlySet<string>): JsonObject {
  const json = zodToUnbundledJson(theme, localDefs);
  return {
    type: 'object',
    properties: isObject(json.properties) ? json.properties : {},
    ...(Array.isArray(json.required) && json.required.length > 0 ? {required: json.required} : {}),
    additionalProperties:
      json.additionalProperties !== undefined ? json.additionalProperties : true,
  };
}

/**
 * A union that no value matches. JSON Schema requires `oneOf` to list at least
 * one schema, so an empty union cannot be written as `{oneOf: []}`.
 */
const EMPTY_UNION: Readonly<JsonObject> = {not: {}};

function buildComponentUnion(names: Iterable<string>): JsonObject {
  const oneOf = [...names].map(name => ({$ref: `#/components/${escapePointer(name)}`}));
  if (oneOf.length === 0) return {...EMPTY_UNION};
  return {oneOf, discriminator: {propertyName: 'component'}};
}

function buildFunctionUnion(names: Iterable<string>): JsonObject {
  const oneOf = [...names].map(name => ({$ref: `#/functions/${escapePointer(name)}`}));
  return oneOf.length === 0 ? {...EMPTY_UNION} : {oneOf};
}

function escapePointer(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Serializes a catalog into an unbundled catalog document.
 *
 * Entries loaded from JSON are emitted from their authored source; entries
 * without a source are serialized from their model with common types
 * references kept external. See `Catalog.toJson` for the full contract.
 *
 * @param catalog The catalog to serialize.
 * @returns A fresh catalog document that shares no objects with the catalog.
 */
export function serializeCatalogDocument(catalog: SerializableCatalog): JsonObject {
  const source = catalog.sourceDocument;
  const isAtLeastV10 = isAtLeastVersion(catalog.protocolVersion, '1.0');
  const authoredDefs: JsonObject = {};
  for (const [name, def] of Object.entries(catalog.defs ?? {})) {
    if (!UNION_DEF_NAMES.has(name)) authoredDefs[name] = def;
  }
  const localDefs = new Set(Object.keys(authoredDefs));

  const doc: JsonObject = {};
  if (catalog.schemaUri !== undefined) doc.$schema = catalog.schemaUri;
  if (catalog.schemaId !== undefined) doc.$id = catalog.schemaId;
  if (catalog.title !== undefined) doc.title = catalog.title;
  if (catalog.description !== undefined) doc.description = catalog.description;
  if (catalog.declaredProtocolVersion !== undefined) {
    doc.protocolVersion = catalog.declaredProtocolVersion;
  } else if (!source) {
    doc.protocolVersion = toCanonicalVersion(catalog.protocolVersion) ?? catalog.protocolVersion;
  }
  doc.catalogId = catalog.id;
  if (catalog.instructions !== undefined) doc.instructions = catalog.instructions;

  // Components.
  const components: JsonObject = {};
  for (const [name, comp] of catalog.components) {
    components[name] = comp.sourceJson
      ? deepCopyJson(comp.sourceJson)
      : serializeComponentModel(name, comp, localDefs);
  }
  if (!source || 'components' in source || catalog.components.size > 0) {
    doc.components = components;
  }

  // Functions, in the form the source used. System functions such as `@index`
  // belong to the protocol rather than the catalog, so a code-defined one that
  // a catalog registers for evaluation is not part of the document.
  const functionEntries = [...catalog.functions].filter(
    ([name, fn]) => fn.sourceJson !== undefined || !name.startsWith('@'),
  );
  const functionNames = functionEntries.map(([name]) => name);
  const functionsAsList = Array.isArray(source?.functions);
  if (functionsAsList) {
    doc.functions = functionEntries.map(([name, fn]) =>
      fn.sourceJson
        ? deepCopyJson(fn.sourceJson)
        : serializeFunctionModel(name, fn, localDefs, isAtLeastV10, true),
    );
  } else if (functionEntries.length > 0 || (source && 'functions' in source)) {
    const functions: JsonObject = {};
    for (const [name, fn] of functionEntries) {
      functions[name] = fn.sourceJson
        ? deepCopyJson(fn.sourceJson)
        : serializeFunctionModel(name, fn, localDefs, isAtLeastV10, false);
    }
    doc.functions = functions;
  }

  // Theme and any other keys the source declared.
  if (source) {
    for (const [key, value] of Object.entries(source)) {
      if (!KNOWN_DOCUMENT_KEYS.has(key)) doc[key] = deepCopyJson(value);
    }
  }

  // Unions.
  const unions: JsonObject = {};
  const sourceDefs = source && isObject(source.$defs) ? source.$defs : undefined;
  if (source) {
    if (sourceDefs && 'anyComponent' in sourceDefs) {
      unions.anyComponent = sameNames(
        catalog.components.keys(),
        sourceEntryNames(source, 'components'),
      )
        ? deepCopyJson(sourceDefs.anyComponent)
        : buildComponentUnion(catalog.components.keys());
    }
    if (sourceDefs && 'anyFunction' in sourceDefs) {
      unions.anyFunction = sameNames(functionNames, sourceEntryNames(source, 'functions'))
        ? deepCopyJson(sourceDefs.anyFunction)
        : buildFunctionUnion(functionNames);
    }
  } else {
    if (isAtLeastV10 || catalog.components.size > 0) {
      unions.anyComponent = buildComponentUnion(catalog.components.keys());
    }
    if (isAtLeastV10 || functionNames.length > 0) {
      unions.anyFunction = buildFunctionUnion(functionNames);
    }
  }

  // Authored definitions, dropping only those that the source referenced but
  // nothing in the output references any more (for example a mixin of a pruned
  // component).
  const defs: JsonObject = {};
  if (Object.keys(authoredDefs).length > 0) {
    const {$defs: _sourceDefs, ...sourceRoots} = (source ?? {}) as JsonObject;
    const sourceReached = source
      ? reachableDefs([sourceRoots, ...Object.values(pickUnions(sourceDefs))], authoredDefs)
      : new Set<string>();
    const unconditional = Object.keys(authoredDefs).filter(name => !sourceReached.has(name));
    const outputReached = reachableDefs(
      [doc, unions, ...unconditional.map(name => authoredDefs[name])],
      authoredDefs,
    );
    for (const [name, def] of Object.entries(authoredDefs)) {
      if (!sourceReached.has(name) || outputReached.has(name)) {
        defs[name] = deepCopyJson(def);
      }
    }
  }
  if (!source && !isAtLeastV10 && catalog.themeSchema && !('theme' in defs)) {
    defs.theme = serializeThemeModel(catalog.themeSchema, localDefs);
  }
  Object.assign(defs, unions);
  if (Object.keys(defs).length > 0 || sourceDefs !== undefined) {
    doc.$defs = defs;
  }

  return doc;
}

function pickUnions(defs: JsonObject | undefined): JsonObject {
  const result: JsonObject = {};
  if (!defs) return result;
  for (const name of UNION_DEF_NAMES) if (name in defs) result[name] = defs[name];
  return result;
}
