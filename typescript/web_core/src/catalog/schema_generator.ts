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

import {isAtLeastVersion, normalizeVersionString, toCanonicalVersion} from '../common/semver.js';
import {CommonSchemas} from '../types/common-types.js';
import {V08_STANDARD_DEFS} from '../v0_8/standard_defs.js';
import {V09_STANDARD_DEFS} from '../v0_9/standard_defs.js';
import {V10_STANDARD_DEFS} from '../v1_0/standard_defs.js';
import {deepCopyJson} from './schema_serializer.js';
import type {CatalogInterface, ComponentApi, FunctionApi} from './types.js';

const STANDARD_DEFS_BY_VERSION: Readonly<Record<string, Record<string, unknown>>> = {
  '0.8': V08_STANDARD_DEFS,
  '0.9': V09_STANDARD_DEFS,
  '0.9.1': V09_STANDARD_DEFS,
  '1.0': V10_STANDARD_DEFS,
};

/**
 * Resolves the appropriate standard $defs dictionary based on options or catalog configuration.
 *
 * An explicit `options.protocolVersion` wins over the catalog's own `protocolVersion`, so a
 * caller can serialize a catalog against another version's definitions. A version with no
 * entry of its own at or above 1.0, such as 1.0.1 or 1.1, gets the v1.0 definitions, as the
 * schema loader and payload validator already treat such versions as v1.0. Any other
 * version falls back to the v0.9 definitions.
 */
function getStandardDefsForCatalog(
  catalog: CatalogInterface<ComponentApi, FunctionApi>,
  options?: GenerateCatalogSchemaOptions,
): Record<string, unknown> {
  if (options?.standardDefs) {
    return options.standardDefs;
  }
  const version = options?.protocolVersion ?? catalog.protocolVersion;
  if (version) {
    const key = toCanonicalVersion(version) ?? normalizeVersionString(version);
    if (key in STANDARD_DEFS_BY_VERSION) {
      return STANDARD_DEFS_BY_VERSION[key];
    }
    if (isAtLeastVersion(version, '1.0')) {
      return V10_STANDARD_DEFS;
    }
  }
  return V09_STANDARD_DEFS;
}

/**
 * Transforms a schema node with a REF description into a `$ref` definition node.
 */
function transformRefDescriptionNode(obj: Record<string, unknown>): boolean {
  if (typeof obj.description !== 'string' || !obj.description.startsWith('REF:')) {
    return false;
  }
  const content = obj.description.substring(4);
  const pipeIndex = content.indexOf('|');
  const ref = pipeIndex === -1 ? content : content.substring(0, pipeIndex);
  const desc = pipeIndex === -1 ? '' : content.substring(pipeIndex + 1);

  const savedDefault = obj.default;
  for (const key of Object.keys(obj)) {
    delete obj[key];
  }
  obj['$ref'] = ref.startsWith('#') ? ref : `#/$defs/${ref.split('/').pop()}`;
  if (savedDefault !== undefined) {
    obj['default'] = savedDefault;
  }
  if (desc) {
    obj['description'] = desc;
  }
  return true;
}

/**
 * Normalizes property schema structures like anyOf and additionalProperties.
 */
function cleanSchemaProperties(
  obj: Record<string, unknown>,
  options: {stripAdditionalProperties?: boolean} = {},
): void {
  // A piped Zod schema, such as the loader's exclusive `oneOf`, comes out as
  // `allOf: [{}, <schema>]`. The empty member constrains nothing.
  if (Array.isArray(obj.allOf)) {
    const members = obj.allOf.filter(
      m => !(typeof m === 'object' && m !== null && Object.keys(m).length === 0),
    );
    const only = members.length === 1 ? members[0] : undefined;
    if (
      typeof only === 'object' &&
      only !== null &&
      !Array.isArray(only) &&
      Object.keys(only).every(key => !(key in obj) || key === 'allOf')
    ) {
      delete obj.allOf;
      Object.assign(obj, only);
    } else if (members.length === 0) {
      delete obj.allOf;
    } else {
      obj.allOf = members;
    }
  }

  if (Array.isArray(obj.anyOf)) {
    obj.oneOf = obj.anyOf;
    delete obj.anyOf;
  }

  if (options.stripAdditionalProperties) {
    delete obj['additionalProperties'];
    delete obj['unevaluatedProperties'];
  } else {
    if (
      obj.additionalProperties &&
      typeof obj.additionalProperties === 'object' &&
      Object.keys(obj.additionalProperties).length === 0
    ) {
      obj.additionalProperties = true;
    }

    if (
      obj.unevaluatedProperties &&
      typeof obj.unevaluatedProperties === 'object' &&
      Object.keys(obj.unevaluatedProperties).length === 0
    ) {
      obj.unevaluatedProperties = true;
    }
  }

  if ('$schema' in obj) {
    delete obj['$schema'];
  }
}

/**
 * Cleans auto-generated Zod schema artifacts and transforms REF markers into explicit `$ref` objects.
 *
 * Removes schema metadata and converts `REF:<url>|<desc>` description markers into `$ref` references.
 *
 * @param node The schema object or array node to sanitize in place.
 * @param visited Set of visited objects to prevent infinite recursion on cyclic structures.
 * @param options Sanitization options such as stripping additionalProperties.
 */
export function cleanSchemaNode(
  node: unknown,
  visited = new Set<unknown>(),
  options: {stripAdditionalProperties?: boolean} = {},
): void {
  if (typeof node !== 'object' || node === null) return;
  if (visited.has(node)) return;
  visited.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      cleanSchemaNode(item, visited, options);
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  if (transformRefDescriptionNode(obj)) {
    return;
  }

  cleanSchemaProperties(obj, options);

  for (const key of Object.keys(obj)) {
    cleanSchemaNode(obj[key], visited, options);
  }
}

/**
 * Configuration options for catalog JSON schema generation.
 */
export interface GenerateCatalogSchemaOptions {
  /** Reference URI to a base component schema envelope (e.g. `common_types.json#/$defs/ComponentCommon`). */
  componentEnvelopeRef?: string;
  /** Explicit standard $defs dictionary to use when serializing catalog components and functions. */
  standardDefs?: Record<string, unknown>;
  /** Explicit protocol version for standard $defs resolution ('v0.8' | 'v0.9' | 'v0.9.1' | 'v1.0'). */
  protocolVersion?: 'v0.8' | 'v0.9' | 'v0.9.1' | 'v1.0' | string;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keywords a reference to a standard definition keeps besides `$ref`. */
const REF_ANNOTATION_KEYWORDS = new Set([
  'description',
  'title',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
  'examples',
]);

/** Keys of the component envelope, which the validation schema declares itself. */
const COMPONENT_ENVELOPE_KEYS = new Set(['id', 'component', 'catalogId']);

/** Definitions of a catalog document that the validation schema generates itself. */
const GENERATED_DEF_NAMES = new Set(['anyComponent', 'anyFunction', 'theme']);

/** Matches a reference to a common type, local or in `common_types.json`. */
const COMMON_TYPE_REF = /^(?:([^#]*common_types\.json))?#\/\$defs\/([^/]+)$/;

/** Matches a reference to a definition of the standard mixins components inherit. */
const STANDARD_MIXIN_REF = /\/(ComponentCommon|Checkable)$/;

/**
 * Configuration the source-backed builders share: the standard definitions of
 * the catalog's protocol version and the authored document local references
 * resolve against.
 */
interface SourceContext {
  readonly standardDefs: Record<string, unknown>;
  readonly rootDoc: JsonObject;
  readonly isV10: boolean;
}

/**
 * Points `node` at the standard definition `name` and, when `node` has no
 * description of its own, gives it the definition's.
 */
function localizeStandardRef(
  node: JsonObject,
  name: string,
  standardDefs: Record<string, unknown>,
): void {
  node['$ref'] = `#/$defs/${name}`;
  if (node['description'] !== undefined) return;
  const definition = standardDefs[name];
  if (isJsonObject(definition) && typeof definition['description'] === 'string') {
    node['description'] = definition['description'];
  }
}

/**
 * Rewrites, in place, every reference in an authored schema to a common type
 * as a local reference to the bundled standard definition.
 *
 * A reference without a description of its own takes the description of the
 * definition it names. With `annotationsOnly`, as for component properties, the
 * reference also drops every keyword other than annotations, since the standard
 * definition alone defines the value.
 */
function restoreSourceRefs(
  node: unknown,
  standardDefs: Record<string, unknown>,
  annotationsOnly: boolean,
): void {
  if (Array.isArray(node)) {
    for (const item of node) restoreSourceRefs(item, standardDefs, annotationsOnly);
    return;
  }
  if (!isJsonObject(node)) return;
  const ref = node['$ref'];
  const match = typeof ref === 'string' ? COMMON_TYPE_REF.exec(ref) : null;
  if (match) {
    const [, document, name] = match;
    if (document !== undefined || name in standardDefs) {
      if (annotationsOnly) {
        for (const key of Object.keys(node)) {
          if (key !== '$ref' && !REF_ANNOTATION_KEYWORDS.has(key)) delete node[key];
        }
        localizeStandardRef(node, name, standardDefs);
        return;
      }
      localizeStandardRef(node, name, standardDefs);
    }
  }
  for (const value of Object.values(node)) {
    restoreSourceRefs(value, standardDefs, annotationsOnly);
  }
}

/** Resolves a local JSON pointer such as `#/$defs/Base` against `rootDoc`. */
function resolveLocalPointer(rootDoc: JsonObject, pointer: string): unknown {
  if (!pointer.startsWith('#/')) return undefined;
  let current: unknown = rootDoc;
  for (const raw of pointer.substring(2).split('/')) {
    const segment = raw.replace(/~([01])/g, (_: string, p1: string) => (p1 === '1' ? '/' : '~'));
    if (!isJsonObject(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Gathers the pieces of an authored component definition that declare its
 * properties: the definition itself, the inline members of its `allOf`, the
 * local definitions those members reference and, last, the standard mixins
 * (`ComponentCommon`, `Checkable` and the like) they reference.
 *
 * A standard mixin contributes its properties and `required` list but not its
 * description, which describes the mixin rather than the component.
 */
function collectSourceSubSchemas(
  schema: JsonObject,
  context: SourceContext,
  result: JsonObject[],
  visited: Set<string>,
): void {
  if ('properties' in schema || 'description' in schema) result.push(schema);
  if (!Array.isArray(schema['allOf'])) return;
  const inline: JsonObject[] = [];
  const local: JsonObject[] = [];
  const mixins: JsonObject[] = [];
  for (const sub of schema['allOf']) {
    if (!isJsonObject(sub)) continue;
    const ref = sub['$ref'];
    if (typeof ref !== 'string') {
      collectSourceSubSchemas(sub, context, inline, visited);
      continue;
    }
    const mixinName = STANDARD_MIXIN_REF.exec(ref)?.[1];
    const target = ref.startsWith('#/') ? resolveLocalPointer(context.rootDoc, ref) : undefined;
    if (mixinName === undefined && isJsonObject(target)) {
      if (!visited.has(ref)) {
        visited.add(ref);
        collectSourceSubSchemas(target, context, local, visited);
      }
      continue;
    }
    const name = mixinName ?? EXTERNAL_DEF_REF.exec(ref)?.[1];
    const mixin = name !== undefined ? context.standardDefs[name] : undefined;
    if (isJsonObject(mixin) && isJsonObject(mixin['properties'])) {
      mixins.push({
        properties: deepCopyJson(mixin['properties']),
        ...(Array.isArray(mixin['required']) ? {required: mixin['required']} : {}),
      });
    }
  }
  result.push(...inline, ...local, ...mixins);
}

/**
 * Builds a component's properties, `required` list and description from its
 * authored definition, as the protocol reads it: the properties of every piece
 * {@link collectSourceSubSchemas} gathers, later pieces overriding earlier ones,
 * and the union of their `required` lists, without the envelope keys.
 */
function sourceComponentSchema(
  source: JsonObject,
  context: SourceContext,
): {props: JsonObject; required: string[]; description?: string} {
  const pieces: JsonObject[] = [];
  collectSourceSubSchemas(source, context, pieces, new Set());
  let description = typeof source['description'] === 'string' ? source['description'] : undefined;
  const props: JsonObject = {};
  const required = new Set<string>();
  for (const piece of pieces) {
    if (description === undefined && typeof piece['description'] === 'string') {
      description = piece['description'];
    }
    if (isJsonObject(piece['properties'])) Object.assign(props, piece['properties']);
    if (Array.isArray(piece['required'])) {
      for (const name of piece['required']) {
        if (typeof name === 'string') required.add(name);
      }
    }
  }
  const copied: JsonObject = {};
  for (const [name, schema] of Object.entries(props)) {
    if (COMPONENT_ENVELOPE_KEYS.has(name)) continue;
    const copy = deepCopyJson(schema);
    restoreSourceRefs(copy, context.standardDefs, true);
    copied[name] = copy;
  }
  return {
    props: copied,
    required: [...required].filter(name => !COMPONENT_ENVELOPE_KEYS.has(name)).sort(),
    ...(description !== undefined ? {description} : {}),
  };
}

/**
 * Returns the `args` schema a function's source document declares, read as the
 * schema loader reads it, or `undefined` for a function defined in code.
 */
function authoredFunctionArgs(fn: FunctionApi): JsonObject | undefined {
  const source = fn.sourceJson;
  if (!source) return undefined;
  const props = isJsonObject(source.properties) ? source.properties : undefined;
  const explicit = props?.args ?? source.args ?? source.parameters;
  if (explicit !== undefined) {
    if (!isJsonObject(explicit)) return {};
    // A bare map of argument schemas, with the object keywords beside it.
    if (Object.keys(explicit).length > 0 && !('properties' in explicit) && !('type' in explicit)) {
      return {
        type: 'object',
        properties: explicit,
        ...(source.required !== undefined ? {required: source.required} : {}),
        ...(source.additionalProperties !== undefined
          ? {additionalProperties: source.additionalProperties}
          : {}),
      };
    }
    return explicit;
  }
  // A definition that is not a call schema is its own argument schema; its
  // description, title and call metadata describe the function, not the
  // arguments.
  const isCallSchema = props && ('call' in props || '@call' in props || 'function' in props);
  if (!props || isCallSchema) return {};
  const {
    description: _description,
    title: _title,
    name: _name,
    returnType: _returnType,
    allowedCallers: _allowedCallers,
    requiresUserActivation: _requiresUserActivation,
    ...args
  } = source;
  return args;
}

/** Returns the theme schema a catalog's source document declares, if any. */
function authoredTheme(
  catalog: CatalogInterface<ComponentApi, FunctionApi>,
): JsonObject | undefined {
  const source = catalog.sourceDocument;
  if (!source) return undefined;
  const defs = isJsonObject(source.$defs) ? source.$defs : undefined;
  const theme = source.theme ?? source.themeSchema ?? source.styles ?? defs?.theme;
  if (!isJsonObject(theme)) return undefined;
  return 'properties' in theme || 'allOf' in theme || theme.type === 'object'
    ? theme
    : {type: 'object', properties: theme};
}

function isV08Catalog(catalog: CatalogInterface<ComponentApi, FunctionApi>): boolean {
  const version = toCanonicalVersion(catalog.protocolVersion) ?? catalog.protocolVersion;
  return version === '0.8' || catalog.id.includes('v0_8') || catalog.id.includes('v0.8');
}

/**
 * Builds the theme definition.
 *
 * A theme loaded from JSON is emitted as written; one defined in code is
 * generated from its Zod schema. From v0.9 a theme that declares neither
 * `additionalProperties` nor `unevaluatedProperties` gets
 * `additionalProperties: true`, as themes are open; a v0.8 theme stays as
 * written.
 */
function processTheme(
  catalog: CatalogInterface<ComponentApi, FunctionApi>,
  defs: JsonObject,
  generated: unknown[],
): void {
  if (!catalog.themeSchema) return;
  const isV08 = isV08Catalog(catalog);

  const authored = authoredTheme(catalog);
  if (authored) {
    const theme = deepCopyJson(authored);
    if (
      !isV08 &&
      theme['additionalProperties'] === undefined &&
      theme['unevaluatedProperties'] === undefined
    ) {
      theme['additionalProperties'] = true;
    }
    defs['theme'] = theme;
    return;
  }

  const themeRaw = zodToJsonSchema(catalog.themeSchema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
  }) as JsonObject;
  cleanSchemaNode(themeRaw);
  mergeGeneratedDefs(themeRaw, defs, generated);

  const closed = themeRaw.additionalProperties === false;
  const themeObj: JsonObject = {
    type: 'object',
    ...(typeof themeRaw.description === 'string' && !themeRaw.description.startsWith('REF:')
      ? {description: themeRaw.description}
      : {}),
    properties: (themeRaw.properties as JsonObject) || {},
    ...(Array.isArray(themeRaw.required) && themeRaw.required.length > 0
      ? {required: themeRaw.required}
      : {}),
    ...(closed
      ? {additionalProperties: false}
      : isV08
        ? {}
        : {
            additionalProperties:
              themeRaw.additionalProperties !== undefined ? themeRaw.additionalProperties : true,
          }),
  };
  generated.push(themeObj);
  defs['theme'] = themeObj;
}

/**
 * Moves the definitions a Zod-generated schema carries into `defs`, recording
 * them as generated.
 */
function mergeGeneratedDefs(raw: JsonObject, defs: JsonObject, generated: unknown[]): void {
  const nested = isJsonObject(raw.definitions)
    ? raw.definitions
    : isJsonObject(raw.$defs)
      ? raw.$defs
      : undefined;
  delete raw.definitions;
  delete raw.$defs;
  if (!nested) return;
  Object.assign(defs, nested);
  generated.push(nested);
}

/**
 * Extracts raw Zod properties, required fields, and definitions from a component API schema.
 */
function extractZodComponentSchema(
  comp: ComponentApi,
  defs: JsonObject,
  generated: unknown[],
): {
  props: JsonObject;
  reqList: string[];
  additionalProps: boolean | JsonObject | undefined;
} {
  if (!comp.schema || typeof comp.schema !== 'object' || !('safeParse' in comp.schema)) {
    return {props: {}, reqList: [], additionalProps: undefined};
  }
  const rawZod = zodToJsonSchema(comp.schema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
  }) as JsonObject;
  cleanSchemaNode(rawZod);
  mergeGeneratedDefs(rawZod, defs, generated);

  const props = (rawZod.properties as JsonObject) || {};
  const reqList = Array.isArray(rawZod.required)
    ? (rawZod.required as string[]).filter(r => r !== 'component' && r !== 'id')
    : [];
  const rawExtra = rawZod.unevaluatedProperties ?? rawZod.additionalProperties;
  const additionalProps =
    typeof rawExtra === 'boolean' || isJsonObject(rawExtra)
      ? (rawExtra as boolean | JsonObject)
      : undefined;

  return {props, reqList, additionalProps};
}

/**
 * Returns the description on a component's Zod schema, ignoring internal
 * `REF:` markers.
 */
function zodComponentDescription(comp: ComponentApi): string | undefined {
  const zodDescription = (comp.schema as {description?: unknown} | undefined)?.description;
  return typeof zodDescription === 'string' && !zodDescription.startsWith('REF:')
    ? zodDescription
    : undefined;
}

/**
 * Returns the closure a component's source document declares
 * (`unevaluatedProperties`, else `additionalProperties`), if any. A component
 * defined in code declares none.
 */
function authoredClosure(comp: ComponentApi): unknown {
  const source = comp.sourceJson;
  if (!source) return undefined;
  return source['unevaluatedProperties'] ?? source['additionalProperties'];
}

/**
 * Builds the schema of one component with the component envelope: an `id`,
 * the `component` constant and the component's own properties.
 *
 * A component loaded from JSON is built from its authored definition, so every
 * nested keyword survives; one defined in code is generated from its Zod
 * schema.
 */
function processSingleComponent(
  name: string,
  comp: ComponentApi,
  defs: JsonObject,
  generated: unknown[],
  context: SourceContext,
  options?: GenerateCatalogSchemaOptions,
): JsonObject {
  let props: JsonObject;
  let reqList: string[];
  let description: string | undefined;
  let closure: unknown;
  if (comp.sourceJson) {
    ({
      props,
      required: reqList,
      description,
    } = sourceComponentSchema(comp.sourceJson as JsonObject, context));
    // From v1.0 the protocol's Component envelope combines the entry with
    // ComponentCommon (accessibility, catalogId, metadata) under its own
    // `unevaluatedProperties: false`, so the entry is closed only when its
    // author closed it. Earlier versions close it unless it was declared open.
    closure = authoredClosure(comp) ?? (context.isV10 ? undefined : false);
  } else {
    const extracted = extractZodComponentSchema(comp, defs, generated);
    const {component: _ignoredComp, id: _ignoredId, ...sanitized} = extracted.props;
    generated.push(sanitized);
    props = sanitized;
    reqList = extracted.reqList;
    description = zodComponentDescription(comp);
    closure = context.isV10 ? undefined : (extracted.additionalProps ?? false);
  }

  const id: JsonObject = {};
  localizeStandardRef(id, 'ComponentId', context.standardDefs);
  const innerProperties = {id, ...props, component: {const: name}};
  const innerRequired = ['id', ...reqList, 'component'];

  const closureEntry = closure !== undefined ? {unevaluatedProperties: closure} : {};
  let compSchemaObj: JsonObject;
  if (options?.componentEnvelopeRef) {
    compSchemaObj = {
      ...(description !== undefined ? {description} : {}),
      allOf: [
        {$ref: options.componentEnvelopeRef},
        {
          type: 'object',
          properties: innerProperties,
          required: innerRequired,
        },
      ],
      ...closureEntry,
    };
  } else {
    compSchemaObj = {
      type: 'object',
      ...(description !== undefined ? {description} : {}),
      properties: innerProperties,
      required: innerRequired,
      ...closureEntry,
    };
  }

  if (comp.allowedParents && comp.allowedParents.length > 0) {
    compSchemaObj['allowedParents'] = comp.allowedParents;
  }
  if (comp.allowedChildren && comp.allowedChildren.length > 0) {
    compSchemaObj['allowedChildren'] = comp.allowedChildren;
  }

  return compSchemaObj;
}

function processComponents(
  catalog: CatalogInterface<ComponentApi, FunctionApi>,
  schema: JsonObject,
  defs: JsonObject,
  generated: unknown[],
  context: SourceContext,
  options?: GenerateCatalogSchemaOptions,
): void {
  if (catalog.components.size === 0) {
    schema['components'] = {};
    return;
  }

  const componentsMap: JsonObject = {};
  for (const [name, comp] of catalog.components.entries()) {
    componentsMap[name] = processSingleComponent(name, comp, defs, generated, context, options);
  }

  schema['components'] = componentsMap;

  defs['anyComponent'] = {
    oneOf: Array.from(catalog.components.keys()).map(name => ({
      $ref: `#/components/${name}`,
    })),
    discriminator: {
      propertyName: 'component',
    },
  };
}

/**
 * Builds the JSON Schema of a function's `args` object, merging any nested
 * definitions into `defs`.
 *
 * Arguments loaded from JSON are copied as written; ones defined in code are
 * generated from their Zod schema. An object schema is closed with
 * `unevaluatedProperties`: the declared `unevaluatedProperties` or
 * `additionalProperties`, and `false` when it declares neither.
 */
function buildFunctionArgsSchema(
  fn: FunctionApi,
  defs: JsonObject,
  generated: unknown[],
  context: SourceContext,
): JsonObject {
  let paramSchemaObj: JsonObject;
  const authored = authoredFunctionArgs(fn);
  if (authored) {
    paramSchemaObj = deepCopyJson(authored);
    restoreSourceRefs(paramSchemaObj, context.standardDefs, false);
  } else if (fn.schema && typeof fn.schema === 'object' && 'safeParse' in fn.schema) {
    const rawZod = zodToJsonSchema(fn.schema, {
      target: 'jsonSchema2019-09',
      $refStrategy: 'none',
    }) as JsonObject;
    cleanSchemaNode(rawZod);
    mergeGeneratedDefs(rawZod, defs, generated);
    generated.push(rawZod);
    paramSchemaObj = rawZod;
  } else {
    paramSchemaObj = {type: 'object', properties: {}};
  }

  if (paramSchemaObj.type === 'object') {
    const additional = paramSchemaObj.additionalProperties;
    delete paramSchemaObj.additionalProperties;
    paramSchemaObj.unevaluatedProperties =
      paramSchemaObj.unevaluatedProperties ?? additional ?? false;
  }

  return paramSchemaObj;
}

/**
 * Builds the schema that validates a wire `FunctionCall` of one function.
 *
 * The call names the function under `callKey` (`call` before v1.0, `@call` from
 * v1.0), passes its arguments under `args` and may restate its `returnType`. A
 * call to a function without required parameters may omit `args` altogether.
 */
function processSingleFunction(
  name: string,
  fn: FunctionApi,
  defs: JsonObject,
  generated: unknown[],
  context: SourceContext,
): JsonObject {
  const argsSchema = buildFunctionArgsSchema(fn, defs, generated, context);
  const hasRequiredArgs = Array.isArray(argsSchema.required) && argsSchema.required.length > 0;
  const callKey = context.isV10 ? '@call' : 'call';
  const required = hasRequiredArgs ? [callKey, 'args'] : [callKey];
  if (context.isV10) {
    // The published v1.0 shape. The entry stays open: the bundled FunctionCall
    // combines it with FunctionCommon (`catalogId` and the like) under its own
    // `unevaluatedProperties: false`, which a closed entry would defeat.
    return {
      type: 'object',
      ...(fn.description ? {description: fn.description} : {}),
      returnType: fn.returnType,
      ...(fn.allowedCallers !== undefined ? {allowedCallers: fn.allowedCallers} : {}),
      ...(fn.requiresUserActivation !== undefined
        ? {requiresUserActivation: fn.requiresUserActivation}
        : {}),
      properties: {
        '@call': {const: name},
        args: argsSchema,
      },
      required,
    };
  }
  return {
    type: 'object',
    ...(fn.description ? {description: fn.description} : {}),
    properties: {
      call: {const: name},
      args: argsSchema,
      returnType: {const: fn.returnType},
    },
    required,
    unevaluatedProperties: false,
  };
}

function processFunctions(
  catalog: CatalogInterface<ComponentApi, FunctionApi>,
  schema: JsonObject,
  defs: JsonObject,
  generated: unknown[],
  context: SourceContext,
): void {
  // System functions such as `@index` are defined by the protocol itself, not
  // by the catalog.
  const names = Array.from(catalog.functions.keys()).filter(name => !name.startsWith('@'));
  if (names.length === 0) return;

  const functionsMap: JsonObject = {};
  for (const name of names) {
    functionsMap[name] = processSingleFunction(
      name,
      catalog.functions.get(name)!,
      defs,
      generated,
      context,
    );
  }

  schema['functions'] = functionsMap;

  defs['anyFunction'] = {
    oneOf: names.map(name => ({
      $ref: `#/functions/${name}`,
    })),
  };
}

/**
 * Descriptions the shared Zod mirrors of the common types carry on their
 * `REF:` markers, by definition name.
 *
 * The mirrors are shared by every protocol version, so their text is one
 * version's. A reference that carries exactly this text did not get it from
 * its author.
 */
const MIRROR_REF_DESCRIPTIONS: ReadonlyMap<string, string> = new Map(
  Object.values(CommonSchemas).flatMap(mirror => {
    const description = (mirror as {description?: unknown}).description;
    if (typeof description !== 'string' || !description.startsWith('REF:')) return [];
    const content = description.substring(4);
    const pipeIndex = content.indexOf('|');
    if (pipeIndex === -1) return [];
    const name = content.substring(0, pipeIndex).split('/').pop()!;
    return [[name, content.substring(pipeIndex + 1)] as [string, string]];
  }),
);

/** Matches a reference to a definition of another document, capturing its name. */
const EXTERNAL_DEF_REF = /^[^#]+#\/(?:\$defs|definitions)\/([^/]+)$/;

/**
 * Rewrites every reference to a definition of another document, such as
 * `common_types.json#/$defs/DynamicString` or `catalog.json#/$defs/anyFunction`,
 * to the bundled `#/$defs/<name>`.
 *
 * @param node The schema to rewrite in place.
 * @param keep A reference to leave as it is: the caller's `componentEnvelopeRef`,
 *     which names a document the caller resolves itself.
 * @throws {Error} If a reference points into another document but not at one of
 *     its definitions, which the bundle cannot carry.
 */
function localizeRefs(node: unknown, keep?: string, visited = new Set<unknown>()): void {
  if (typeof node !== 'object' || node === null || visited.has(node)) return;
  visited.add(node);
  if (Array.isArray(node)) {
    for (const item of node) localizeRefs(item, keep, visited);
    return;
  }
  const obj = node as JsonObject;
  const ref = obj['$ref'];
  if (typeof ref === 'string' && !ref.startsWith('#') && ref !== keep) {
    const match = EXTERNAL_DEF_REF.exec(ref);
    if (!match) {
      throw new Error(`Cannot bundle the external schema reference '${ref}'.`);
    }
    obj['$ref'] = `#/$defs/${match[1]}`;
  }
  for (const value of Object.values(obj)) localizeRefs(value, keep, visited);
}

/**
 * Gives each reference to a standard definition in a Zod-generated schema the
 * description of the definition it names, from the catalog's own protocol
 * version, unless the reference has a description of its own.
 */
function describeStandardRefs(
  node: unknown,
  standardDefs: Record<string, unknown>,
  visited = new Set<unknown>(),
): void {
  if (typeof node !== 'object' || node === null || visited.has(node)) return;
  visited.add(node);
  if (Array.isArray(node)) {
    for (const item of node) describeStandardRefs(item, standardDefs, visited);
    return;
  }
  const obj = node as JsonObject;
  const ref = obj['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
    const name = ref.substring('#/$defs/'.length);
    const definition = standardDefs[name] as JsonObject | undefined;
    const inherited =
      obj['description'] === undefined || obj['description'] === MIRROR_REF_DESCRIPTIONS.get(name);
    if (definition && inherited) {
      if (typeof definition['description'] === 'string') {
        obj['description'] = definition['description'];
      } else {
        delete obj['description'];
      }
    }
  }
  for (const value of Object.values(obj)) describeStandardRefs(value, standardDefs, visited);
}

function collectReferencedDefs(
  node: unknown,
  referenced: Set<string>,
  visited = new Set<unknown>(),
): void {
  if (typeof node !== 'object' || node === null) return;
  if (visited.has(node)) return;
  visited.add(node);

  if (typeof (node as JsonObject)['$ref'] === 'string') {
    const ref = (node as JsonObject)['$ref'] as string;
    if (ref.startsWith('#/$defs/')) {
      referenced.add(ref.substring('#/$defs/'.length));
    }
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectReferencedDefs(item, referenced, visited);
    }
  } else {
    for (const val of Object.values(node as JsonObject)) {
      collectReferencedDefs(val, referenced, visited);
    }
  }
}

/**
 * Reconstructs a specification-compliant A2UI catalog JSON Schema document from a Catalog instance.
 *
 * Components, functions and a theme loaded from JSON are built from their
 * authored definitions; ones defined in code are generated from their Zod
 * schemas. References to common types become local references, and the
 * standard definitions and authored local definitions they reach are copied
 * into `$defs`, alongside the component and function unions.
 *
 * @param catalog The catalog instance to serialize.
 * @param options Optional configuration options such as component envelope wrapping.
 * @returns Specification-compliant A2UI Catalog JSON Schema object.
 */
export function generateCatalogSchema<
  T extends ComponentApi = ComponentApi,
  F extends FunctionApi = FunctionApi,
>(catalog: CatalogInterface<T, F>, options?: GenerateCatalogSchemaOptions): JsonObject {
  const schema: JsonObject = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    // The declared version, in the bare semantic version form
    // catalog_definition.json requires: `v0.9.1` becomes `0.9.1`.
    ...(catalog.declaredProtocolVersion !== undefined
      ? {protocolVersion: catalog.declaredProtocolVersion.trim().replace(/^[vV](?=\d)/, '')}
      : {}),
    catalogId: catalog.id,
  };

  if (catalog.instructions) {
    schema['instructions'] = catalog.instructions;
  }

  const standardDefs = getStandardDefsForCatalog(catalog, options);
  const version = options?.protocolVersion ?? catalog.protocolVersion;
  const rootDoc: JsonObject = isJsonObject(catalog.sourceDocument)
    ? (catalog.sourceDocument as JsonObject)
    : {};
  const context: SourceContext = {
    standardDefs,
    rootDoc,
    isV10: Boolean(version) && isAtLeastVersion(version, '1.0'),
  };
  const authoredDefs = isJsonObject(rootDoc['$defs']) ? rootDoc['$defs'] : (catalog.defs ?? {});

  const defs: JsonObject = {};
  // The parts generated from Zod schemas, whose references to standard
  // definitions take those definitions' descriptions.
  const generated: unknown[] = [];

  processTheme(catalog, defs, generated);
  processComponents(catalog, schema, defs, generated, context, options);
  processFunctions(catalog, schema, defs, generated, context);

  // Everything generated so far is the catalog's own content; standard
  // definitions are copied in below and left as their version defines them.
  localizeRefs(schema, options?.componentEnvelopeRef);
  localizeRefs(defs);
  for (const node of generated) describeStandardRefs(node, standardDefs);

  // Fixed-point iteration to discover all transitive $defs references
  let defsCountBefore: number;
  do {
    defsCountBefore = Object.keys(defs).length;
    const referenced = new Set<string>();
    collectReferencedDefs(schema, referenced);
    collectReferencedDefs(defs, referenced);

    if (
      referenced.has('DynamicString') ||
      referenced.has('DynamicNumber') ||
      referenced.has('DynamicBoolean') ||
      referenced.has('DynamicValue')
    ) {
      referenced.add('DataBinding');
      referenced.add('FunctionCall');
    }

    for (const refName of referenced) {
      if (refName in defs) continue;
      if (refName in standardDefs) {
        const copied = deepCopyJson(standardDefs[refName]);
        localizeRefs(copied);
        defs[refName] = copied;
      } else if (!GENERATED_DEF_NAMES.has(refName) && refName in authoredDefs) {
        // A definition of the catalog's own, which an authored entry names.
        const copied = deepCopyJson(authoredDefs[refName]);
        restoreSourceRefs(copied, standardDefs, false);
        localizeRefs(copied);
        defs[refName] = copied;
      }
    }

    // FunctionCall names the catalog's function union. A catalog without
    // functions gets the empty union, so the reference still resolves.
    if (referenced.has('anyFunction') && !('anyFunction' in defs)) {
      defs['anyFunction'] = {not: {}};
    }
  } while (Object.keys(defs).length > defsCountBefore);

  if (Object.keys(defs).length > 0) {
    schema['$defs'] = defs;
  }

  return schema;
}
