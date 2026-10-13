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

import type {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';

import {isAtLeastVersion, toCanonicalVersion} from '../common/semver.js';
import {loadedDefinition} from './json_entries.js';
import {getSpecAnnotation, type JsonSchemaObject} from './spec_annotations.js';
import {
  DEFAULT_COMMON_TYPES_URI,
  isSpecComponentSchema,
  isSpecFunctionSchema,
  SpecShaper,
} from './spec_shape.js';
import type {CatalogUnions, ComponentApi, FunctionApi} from './types.js';

/** Names of the union definitions a catalog computes from its entries. */
export const UNION_DEF_NAMES: ReadonlySet<string> = new Set(['anyComponent', 'anyFunction']);

/** Top-level keys under which a catalog document may declare its theme. */
export const THEME_DOCUMENT_KEYS = ['theme', 'themeSchema', 'styles'] as const;

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
  readonly declaredProtocolVersion?: string | null;
  readonly declaresCatalogId?: boolean;
  readonly declaresComponents?: boolean;
  readonly functionsLayout?: 'map' | 'list';
  readonly unions?: CatalogUnions;
  readonly defs?: Readonly<Record<string, unknown>>;
  readonly extensionFields?: Readonly<Record<string, unknown>>;
  readonly commonTypesUri?: string;
  readonly themeLocation?: 'defs' | 'styles';
  readonly defModels?: readonly z.ZodTypeAny[];
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

/**
 * Freezes a JSON value and everything it contains, in place.
 *
 * @param value JSON-compatible value.
 * @returns `value`.
 */
export function deepFreeze<V>(value: V): V {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Returns a deeply frozen copy of a JSON value, or the value itself when it is
 * already frozen.
 *
 * @param value JSON-compatible value.
 */
export function frozenJson<V>(value: V): V {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  return deepFreeze(deepCopyJson(value));
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Adds to `found` the name of every definition a local `#/$defs/<name>`
 * reference in `node` reaches: the first segment of its pointer.
 */
function collectLocalDefNames(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectLocalDefNames(item, found);
    return;
  }
  if (!isObject(node)) return;
  const ref = node.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
    found.add(ref.slice('#/$defs/'.length).split('/')[0].replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  for (const value of Object.values(node)) collectLocalDefNames(value, found);
}

/**
 * Returns the names of the definitions `roots` reach through local
 * references, directly or through other definitions of `defs`. Names `defs`
 * does not define are included.
 */
function reachableDefs(roots: unknown[], defs: Readonly<JsonObject>): Set<string> {
  const reached = new Set<string>();
  const pending = new Set<string>();
  for (const root of roots) collectLocalDefNames(root, pending);
  while (pending.size > 0) {
    const [name] = pending;
    pending.delete(name);
    if (reached.has(name)) continue;
    reached.add(name);
    if (name in defs) collectLocalDefNames(defs[name], pending);
  }
  return reached;
}

/**
 * Returns the definition of an entry `Catalog.fromJson` loaded, if
 * `toJson` and `validationSchema` can use it in a catalog with `defs`, or
 * `undefined` when they should build the entry from its model instead.
 *
 * A definition is used when every local `#/$defs/<name>` reference it reaches
 * resolves against `defs` (or names a union the catalog computes). A loaded
 * entry reused in a catalog without the definitions it references falls back
 * to its Zod schema.
 *
 * @param entry A component or function.
 * @param defs The definitions of the catalog that holds the entry.
 */
export function entryDefinition(
  entry: ComponentApi | FunctionApi,
  defs: Readonly<JsonObject> | undefined,
): JsonSchemaObject | undefined {
  const definition = loadedDefinition(entry);
  if (!isObject(definition)) return undefined;
  const available = defs ?? {};
  for (const name of reachableDefs([definition], available)) {
    if (!(name in available) && !UNION_DEF_NAMES.has(name)) return undefined;
  }
  return definition;
}

/**
 * Whether a function definition is an item of a `functions` list (with its
 * `name` and `parameters`) rather than an entry of a `functions` map.
 */
export function isFunctionListItem(definition: JsonSchemaObject): boolean {
  return typeof definition['name'] === 'string' && !('properties' in definition);
}

/**
 * Returns the definitions of `defs` that a catalog with the entries `after`
 * keeps, given that it is derived from a catalog with the entries `before`.
 *
 * A definition that only entries of `before` missing from `after` reached is
 * dropped. One that no entry of `before` reached, such as a theme, is kept,
 * and so is everything it reaches.
 *
 * @param defs The `defs` of the catalog derived from.
 * @param before The entries of the catalog derived from.
 * @param after The entries of the derived catalog.
 * @param extensionFields The document's other top-level fields, whose
 *     references keep definitions too.
 * @returns `defs` itself when nothing is dropped.
 */
export function retainedDefs(
  defs: Readonly<JsonObject> | undefined,
  before: ReadonlyArray<ComponentApi | FunctionApi>,
  after: ReadonlyArray<ComponentApi | FunctionApi>,
  extensionFields?: Readonly<JsonObject>,
): Readonly<JsonObject> | undefined {
  if (!defs) return defs;
  const definitions = (entries: ReadonlyArray<ComponentApi | FunctionApi>) =>
    entries.map(entry => entryDefinition(entry, defs)).filter(d => d !== undefined);
  const reachedBefore = reachableDefs(definitions(before), defs);
  const unconditional = Object.keys(defs).filter(name => !reachedBefore.has(name));
  const reachedAfter = reachableDefs(
    [...definitions(after), extensionFields, ...unconditional.map(name => defs[name])],
    defs,
  );
  const kept: JsonObject = {};
  let dropped = false;
  for (const [name, def] of Object.entries(defs)) {
    if (!reachedBefore.has(name) || reachedAfter.has(name)) {
      kept[name] = def;
    } else {
      dropped = true;
    }
  }
  return dropped ? kept : defs;
}

/**
 * Rewrites `REF:<ref>|<description>` markers left by the loader and by
 * code-defined schemas into `$ref` nodes, keeping common types references
 * external (`<commonTypesUri>#/$defs/<name>`).
 *
 * @param node Schema node to rewrite in place.
 * @param localDefs Names of authored definitions that stay local references.
 * @param commonTypesUri The URI of the common types document.
 */
function rewriteRefMarkers(
  node: unknown,
  localDefs: ReadonlySet<string>,
  commonTypesUri: string = DEFAULT_COMMON_TYPES_URI,
): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefMarkers(item, localDefs, commonTypesUri);
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
    // The first segment names the definition; a deeper pointer into it, such as
    // `/oneOf/0`, is kept whole.
    const pointer = ref.split(/#\/(?:\$defs|definitions)\//)[1];
    const defName = pointer?.split('/')[0];
    node.$ref =
      defName === undefined
        ? ref
        : ref.startsWith('#') && localDefs.has(defName)
          ? ref
          : `${commonTypesUri}#/$defs/${pointer}`;
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
  for (const value of Object.values(node)) rewriteRefMarkers(value, localDefs, commonTypesUri);
}

/**
 * Converts a Zod schema into an unbundled JSON Schema object.
 */
function zodToUnbundledJson(
  schema: z.ZodTypeAny | undefined,
  localDefs: ReadonlySet<string>,
  commonTypesUri: string = DEFAULT_COMMON_TYPES_URI,
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
  rewriteRefMarkers(json, localDefs, commonTypesUri);
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
  commonTypesUri: string = DEFAULT_COMMON_TYPES_URI,
): JsonObject {
  const json = zodToUnbundledJson(comp.schema, localDefs, commonTypesUri);
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
  commonTypesUri: string = DEFAULT_COMMON_TYPES_URI,
): JsonObject {
  const args = zodToUnbundledJson(fn.schema, localDefs, commonTypesUri);
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
  // A call to a function without required parameters may omit `args`, as in
  // the validation schema.
  const argsRequired = Array.isArray(args.required) && args.required.length > 0;
  const result: JsonObject = {type: 'object'};
  if (fn.description) result.description = fn.description;
  if (isAtLeastV10) {
    result.returnType = fn.returnType;
    if (fn.allowedCallers) result.allowedCallers = fn.allowedCallers;
    if (fn.requiresUserActivation !== undefined) {
      result.requiresUserActivation = fn.requiresUserActivation;
    }
    result.properties = {'@call': {const: name}, args};
    result.required = argsRequired ? ['@call', 'args'] : ['@call'];
    return result;
  }
  if (fn.allowedCallers) result.allowedCallers = fn.allowedCallers;
  if (fn.requiresUserActivation !== undefined) {
    result.requiresUserActivation = fn.requiresUserActivation;
  }
  result.properties = {call: {const: name}, args, returnType: {const: fn.returnType}};
  result.required = argsRequired ? ['call', 'args'] : ['call'];
  result.unevaluatedProperties = false;
  return result;
}

/**
 * Serializes a theme Zod schema into a `$defs.theme` object schema.
 */
function serializeThemeModel(
  theme: z.ZodTypeAny,
  localDefs: ReadonlySet<string>,
  commonTypesUri: string = DEFAULT_COMMON_TYPES_URI,
): JsonObject {
  const json = zodToUnbundledJson(theme, localDefs, commonTypesUri);
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

export function buildComponentUnion(names: Iterable<string>): JsonObject {
  const oneOf = [...names].map(name => ({$ref: `#/components/${escapePointer(name)}`}));
  if (oneOf.length === 0) return {...EMPTY_UNION};
  return {oneOf, discriminator: {propertyName: 'component'}};
}

export function buildFunctionUnion(names: Iterable<string>): JsonObject {
  const oneOf = [...names].map(name => ({$ref: `#/functions/${escapePointer(name)}`}));
  return oneOf.length === 0 ? {...EMPTY_UNION} : {oneOf};
}

function escapePointer(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * A catalog's document in model form: the definition of each entry, where it
 * has one, and the document's definitions and other top-level fields.
 */
export interface CatalogDocumentModel {
  /**
   * The definition of each component: the one `fromJson` loaded, or the one
   * computed from a specification model. `undefined` for a component that
   * `toJson` and `validationSchema` generate from its Zod schema.
   */
  readonly components: ReadonlyMap<string, JsonSchemaObject | undefined>;
  /** The definition of each function, as for `components`. */
  readonly functions: ReadonlyMap<string, JsonSchemaObject | undefined>;
  /**
   * The document's named definitions, without the computed unions: the
   * catalog's `defs`, and the definitions computed from its models (the
   * mixins of its components and its `defModels`).
   */
  readonly defs: Readonly<JsonObject>;
  /**
   * The document's other top-level fields: the catalog's `extensionFields`
   * and a theme written under `styles`.
   */
  readonly extensionFields: Readonly<JsonObject>;
}

const documentModels = new WeakMap<object, CatalogDocumentModel>();

/**
 * Returns the document model of a catalog, computed from the catalog's
 * entries, fields and models, and memoized per catalog. It is deeply frozen.
 *
 * @param catalog The catalog.
 */
export function catalogDocumentModel(catalog: SerializableCatalog): CatalogDocumentModel {
  let model = documentModels.get(catalog);
  if (!model) {
    model = buildDocumentModel(catalog);
    documentModels.set(catalog, model);
  }
  return model;
}

function buildDocumentModel(catalog: SerializableCatalog): CatalogDocumentModel {
  const shaper = new SpecShaper(catalog.protocolVersion, catalog.commonTypesUri);
  const computedDefs = new Map<string, z.ZodTypeAny>();
  const shapedComponents = new Map<string, JsonSchemaObject>();
  for (const [name, comp] of catalog.components) {
    if (loadedDefinition(comp) || !isSpecComponentSchema(comp.schema)) continue;
    const {schema, catalogDefs} = shaper.componentSchema(
      name,
      comp.schema,
      comp.allowedParents,
      comp.allowedChildren,
    );
    shapedComponents.set(name, deepFreeze(schema));
    for (const [defName, defModel] of catalogDefs) computedDefs.set(defName, defModel);
  }
  for (const defModel of catalog.defModels ?? []) {
    const defName = getSpecAnnotation(defModel)?.defName;
    if (defName === undefined) {
      throw new Error('A catalog definition model must be named with specDef().');
    }
    computedDefs.set(defName, defModel);
  }

  const defs: JsonObject = {...catalog.defs};
  for (const [defName, defModel] of computedDefs) {
    if (!(defName in defs)) defs[defName] = shaper.defSchema(defModel);
  }
  const extensionFields: JsonObject = {...catalog.extensionFields};
  if (catalog.themeLocation === 'styles' && catalog.themeSchema && !hasAuthoredTheme(catalog)) {
    const theme = shaper.defSchema(catalog.themeSchema);
    extensionFields['styles'] = isObject(theme['properties']) ? theme['properties'] : {};
  }

  const components = new Map<string, JsonSchemaObject | undefined>();
  for (const [name, comp] of catalog.components) {
    components.set(name, shapedComponents.get(name) ?? entryDefinition(comp, defs));
  }
  const functions = new Map<string, JsonSchemaObject | undefined>();
  for (const [name, fn] of catalog.functions) {
    const loaded = entryDefinition(fn, defs);
    functions.set(
      name,
      loaded ??
        (!loadedDefinition(fn) && isSpecFunctionSchema(fn.schema)
          ? deepFreeze(shaper.functionSchema(name, fn))
          : undefined),
    );
  }
  return {
    components,
    functions,
    defs: deepFreeze(defs),
    extensionFields: deepFreeze(extensionFields),
  };
}

/** Whether the catalog's `defs` or top-level fields declare a theme. */
function hasAuthoredTheme(catalog: {
  readonly defs?: Readonly<JsonObject>;
  readonly extensionFields?: Readonly<JsonObject>;
}): boolean {
  return (
    isObject(catalog.defs?.['theme']) ||
    THEME_DOCUMENT_KEYS.some(key => catalog.extensionFields?.[key] !== undefined)
  );
}

/**
 * Serializes a catalog into an unbundled catalog document, assembled from the
 * catalog's model. See `Catalog.toJson` for the full contract.
 *
 * @param catalog The catalog to serialize.
 * @returns A fresh catalog document that shares no objects with the catalog.
 */
export function serializeCatalogDocument(catalog: SerializableCatalog): JsonObject {
  const isAtLeastV10 = isAtLeastVersion(catalog.protocolVersion, '1.0');
  const model = catalogDocumentModel(catalog);
  const localDefs = new Set(Object.keys(model.defs));

  const doc: JsonObject = {};
  if (catalog.schemaUri !== undefined) doc.$schema = catalog.schemaUri;
  if (catalog.schemaId !== undefined) doc.$id = catalog.schemaId;
  if (typeof catalog.declaredProtocolVersion === 'string') {
    doc.protocolVersion = catalog.declaredProtocolVersion;
  } else if (catalog.declaredProtocolVersion === undefined) {
    doc.protocolVersion = toCanonicalVersion(catalog.protocolVersion) ?? catalog.protocolVersion;
  }
  if (catalog.title !== undefined) doc.title = catalog.title;
  if (catalog.description !== undefined) doc.description = catalog.description;
  if (catalog.declaresCatalogId !== false) doc.catalogId = catalog.id;
  if (catalog.instructions !== undefined) doc.instructions = catalog.instructions;

  // Components, unless the document has no `components` key and the catalog
  // has none.
  const commonTypesUri = catalog.commonTypesUri ?? DEFAULT_COMMON_TYPES_URI;
  if (catalog.declaresComponents !== false || catalog.components.size > 0) {
    const components: JsonObject = {};
    for (const [name, comp] of catalog.components) {
      const definition = model.components.get(name);
      components[name] = definition
        ? deepCopyJson(definition)
        : serializeComponentModel(name, comp, localDefs, commonTypesUri);
    }
    doc.components = components;
  }

  // Functions, in the document's layout. System functions such as `@index`
  // belong to the protocol rather than the catalog, so a code-defined one that
  // a catalog registers for evaluation is not part of the document.
  const functionEntries = [...catalog.functions].filter(
    ([name, fn]) => loadedDefinition(fn) !== undefined || !name.startsWith('@'),
  );
  const functionNames = functionEntries.map(([name]) => name);
  if (catalog.functionsLayout === 'list') {
    doc.functions = functionEntries.map(([name, fn]) => {
      const definition = model.functions.get(name);
      return definition && isFunctionListItem(definition)
        ? deepCopyJson(definition)
        : serializeFunctionModel(name, fn, localDefs, isAtLeastV10, true, commonTypesUri);
    });
  } else if (catalog.functionsLayout === 'map' || functionEntries.length > 0) {
    const functions: JsonObject = {};
    for (const [name, fn] of functionEntries) {
      const definition = model.functions.get(name);
      functions[name] =
        definition && !isFunctionListItem(definition)
          ? deepCopyJson(definition)
          : serializeFunctionModel(name, fn, localDefs, isAtLeastV10, false, commonTypesUri);
    }
    doc.functions = functions;
  }

  // Any other top-level keys of the document, such as a v0.8 `styles` theme.
  for (const [key, value] of Object.entries(model.extensionFields)) {
    if (!(key in doc)) doc[key] = deepCopyJson(value);
  }

  // Definitions: the catalog's own and those computed from its models, a
  // theme generated from Zod for a catalog defined in code, and the computed
  // unions.
  const {
    anyComponent: authoredAnyComponent,
    anyFunction: authoredAnyFunction,
    ...nonUnionDefs
  } = model.defs;
  const defs: JsonObject = deepCopyJson(nonUnionDefs);
  const themeLocation = catalog.themeLocation ?? (isAtLeastV10 ? undefined : 'defs');
  if (themeLocation === 'defs' && catalog.themeSchema && !hasAuthoredTheme(model)) {
    defs.theme = getSpecAnnotation(catalog.themeSchema)
      ? new SpecShaper(catalog.protocolVersion, catalog.commonTypesUri).defSchema(
          catalog.themeSchema,
        )
      : serializeThemeModel(catalog.themeSchema, localDefs, commonTypesUri);
  }
  const unions = catalog.unions ?? {
    anyComponent: isAtLeastV10 || catalog.components.size > 0,
    anyFunction: isAtLeastV10 || functionNames.length > 0,
  };
  if (unions.anyComponent && !('anyComponent' in defs)) {
    const savedAnyFunction = defs.anyFunction;
    if (savedAnyFunction !== undefined) delete defs.anyFunction;
    defs.anyComponent = buildComponentUnion(catalog.components.keys());
    if (savedAnyFunction !== undefined) defs.anyFunction = savedAnyFunction;
  }
  if (authoredAnyFunction !== undefined) {
    defs.anyFunction = deepCopyJson(authoredAnyFunction);
  } else if (unions.anyFunction) {
    defs.anyFunction = buildFunctionUnion(functionNames);
  }
  if (catalog.defs !== undefined || Object.keys(defs).length > 0) {
    doc.$defs = defs;
  }
  return doc;
}
