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

import {validateMetadata} from '../common/metadata.js';
import {isAtLeastVersion} from '../common/semver.js';
import {assertUax31Identifier} from '../common/uax31.js';
import {A2uiCatalogError, noValidatorError} from '../errors.js';
import {namedJsonSchema} from '../schema-engine/from-json-schema.js';
import type {CatalogSchema, JsonSchema, JsonSchemaValidator} from '../schema-engine/types.js';
import {envelopeCatalogDocument} from '../schema-engine/common-types.js';
import {basename, commonTypesFor, externalDocuments} from './entry-schema.js';
import {JsonComponentApi, JsonFunctionApi} from './json_entries.js';
import {
  buildComponentUnion,
  buildFunctionUnion,
  deepCopyJson,
  deepFreeze,
} from './schema_serializer.js';
import type {CatalogDocumentOptions, ComponentApi, FunctionApi} from './types.js';

/**
 * The fields of a parsed catalog document: its ID, version and entries, and
 * the document-level fields a `Catalog` keeps so that `toJson` reproduces the
 * document.
 */
export interface ParsedCatalogSchema extends CatalogDocumentOptions {
  id: string;
  protocolVersion: string;
  components: ComponentApi[];
  functions: FunctionApi[];
  themeSchema?: CatalogSchema;
}

/**
 * Protocol version assumed for a catalog schema that does not declare one.
 *
 * Catalog schemas only began carrying `protocolVersion` at v1.0, so a schema
 * that omits it predates that field.
 */
export const DEFAULT_PROTOCOL_VERSION = '0.9';

/** Options for `Catalog.fromJson`. */
export interface FromJsonOptions {
  /**
   * The JSON Schema validator the catalog's entries validate with, such as
   * `createAjvValidator()` from `@a2ui/validator-ajv`.
   */
  readonly validator: JsonSchemaValidator;
  /**
   * Documents the catalog `$ref`s, keyed by basename, that it ships with
   * itself, such as its own `common_types.json`. Each one replaces the
   * protocol's document of that name for this catalog's entries; a basename
   * the protocol does not define (pre-1.0, where a catalog may refer to other
   * documents) is added. `catalog.json` is always the catalog document itself.
   */
  readonly documents?: Readonly<Record<string, JsonSchema>>;
}

const CATALOG_DOCUMENT = 'catalog.json';
const COMMON_TYPES_DOCUMENT = 'common_types.json';

/** The keywords whose values are data, not schemas, so their `$ref`s are not references. */
const DATA_KEYWORDS = new Set(['const', 'enum', 'default', 'examples']);

/**
 * The object schema of a bare map of argument schemas, with the object
 * keywords its definition writes beside it.
 */
function shorthandObject(
  properties: Record<string, unknown>,
  beside: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const schema: Record<string, unknown> = {type: 'object', properties};
  if (beside.required !== undefined) schema.required = beside.required;
  if (beside.additionalProperties !== undefined) {
    schema.additionalProperties = beside.additionalProperties;
  }
  return schema;
}

/**
 * A copy of a schema node of the catalog document whose local `#...`
 * references point into the document by name (`catalog.json#...`), so the
 * copy can be compiled as a root of its own.
 */
function rebased(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rebased);
  if (!isPlainObject(node)) return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#')) {
      copy[key] = CATALOG_DOCUMENT + value;
    } else {
      copy[key] = DATA_KEYWORDS.has(key) ? value : rebased(value);
    }
  }
  return copy;
}

/**
 * The name of the local definition a `$ref` of the catalog document names
 * (`#/$defs/<name>`, or `catalog.json#/$defs/<name>`), if any.
 */
function localDefName(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const pointer = ref.startsWith(CATALOG_DOCUMENT) ? ref.slice(CATALOG_DOCUMENT.length) : ref;
  const match = /^#\/\$defs\/([^/]+)$/.exec(pointer);
  return match ? match[1].replace(/~1/g, '/').replace(/~0/g, '~') : undefined;
}

/**
 * A copy of a component's object schema that leaves the envelope fields
 * (see {@link isEnvelopeField}) to the envelope: they are not required, and
 * `component` and `@catalogId` are not declared. `id` stays declared, as
 * `true`, so that an object that inlines `ComponentCommon` still reads as
 * one (see `componentMixinLayout`), without `id` being a child reference.
 *
 * Applies to the object itself and its `allOf`, `anyOf` and `oneOf`
 * members, not to its properties' schemas, where `id` and `component` are
 * ordinary names. The local definitions such an object references are named
 * in `referenced`, so their objects get the same treatment.
 */
function withoutEnvelopeFields(node: unknown, referenced: Set<string>): unknown {
  if (!isPlainObject(node)) return node;
  const copy: Record<string, unknown> = {...node};
  const defName = localDefName(node['$ref']);
  if (defName !== undefined) referenced.add(defName);
  const properties = node['properties'];
  if (isPlainObject(properties) && Object.keys(properties).some(isEnvelopeField)) {
    const own: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      if (key === 'id') own[key] = true;
      else if (!isEnvelopeField(key)) own[key] = value;
    }
    copy['properties'] = own;
  }
  if (Array.isArray(node['required'])) {
    copy['required'] = node['required'].filter(key => !isEnvelopeField(String(key)));
  }
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    const members = node[key];
    if (Array.isArray(members)) {
      copy[key] = members.map(member => withoutEnvelopeFields(member, referenced));
    }
  }
  return copy;
}

/**
 * The names of the local definitions the `$ref`s in `node` name
 * (`#/$defs/<name>`), wherever they are.
 */
function localDefRefs(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) localDefRefs(item, found);
  } else if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref') {
        const name = localDefName(value);
        if (name !== undefined) found.add(name);
      } else if (!DATA_KEYWORDS.has(key)) {
        localDefRefs(value, found);
      }
    }
  }
  return found;
}

/**
 * The stand-in for the catalog's `anyFunction` that a v1.0 `FunctionCall` in
 * an entry's schema is validated against: a call names its function and
 * gives its arguments (and, through `FunctionCommon`, its catalog), and the
 * common types' `unevaluatedProperties: false` rejects any other key. The
 * arguments are validated on their own, against the function in the catalog
 * the call runs in (see `PayloadValidator`), and `@index` is left to the
 * common types' `IndexSystemFunction`.
 */
const V10_ANY_FUNCTION = {
  type: 'object',
  properties: {'@call': {not: {const: '@index'}}, 'args': true},
};

/**
 * The v0.9 counterpart of {@link V10_ANY_FUNCTION}: the keys a call may
 * carry, and no other.
 */
const V09_ANY_FUNCTION = {
  type: 'object',
  properties: {call: true, args: true, returnType: true, catalogId: true},
  additionalProperties: false,
};

/**
 * The documents a loaded catalog's entries validate with, keyed as their
 * `$ref`s name them: the catalog document as `catalog.json` and the protocol
 * version's common types as `common_types.json`, also under every other
 * spelling of those two names the documents use (such as
 * `https://a2ui.org/specification/v0_9/common_types.json`), and under the
 * names those spellings give each other.
 *
 * Both are adjusted, on copies, for validating an entry on its own:
 * - The objects of every component, of the local definitions they compose,
 *   and of `ComponentCommon` leave the envelope fields out (see
 *   {@link withoutEnvelopeFields}), because a component's properties are
 *   validated apart from its envelope.
 * - The catalog's `anyComponent` is the protocol envelope's, and its
 *   `anyFunction` a stand-in that checks only a call's own keys
 *   ({@link V10_ANY_FUNCTION}, {@link V09_ANY_FUNCTION}): a function call in
 *   a component's properties or a function's arguments is validated on its
 *   own, against the catalog the call runs in (see `PayloadValidator`).
 * - A local `#/$defs/<name>` the catalog does not define, but the common
 *   types do, refers to the common types' definition, as catalogs written
 *   against the common types' names expect.
 */
function entryDocuments(
  catalog: Readonly<Record<string, unknown>>,
  protocolVersion: string,
  supplied: Readonly<Record<string, JsonSchema>> = {},
): Record<string, JsonSchema> {
  const atLeastV10 = isAtLeastVersion(protocolVersion, '1.0');
  const envelope = envelopeCatalogDocument(atLeastV10 ? '1.0' : '0.9') as {
    $defs: Record<string, unknown>;
  };
  const specCommonTypes = (supplied[COMMON_TYPES_DOCUMENT] ??
    commonTypesFor(protocolVersion)) as Record<string, unknown>;
  const specDefs = (
    isPlainObject(specCommonTypes['$defs']) ? specCommonTypes['$defs'] : {}
  ) as Record<string, unknown>;
  const commonTypes: Record<string, unknown> = {
    ...specCommonTypes,
    $defs:
      'ComponentCommon' in specDefs
        ? {
            ...specDefs,
            ComponentCommon: withoutEnvelopeFields(specDefs['ComponentCommon'], new Set()),
          }
        : specDefs,
  };

  const referenced = new Set<string>();
  const components: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(
    isPlainObject(catalog['components']) ? catalog['components'] : {},
  )) {
    components[name] = withoutEnvelopeFields(definition, referenced);
  }
  const catalogDefs = isPlainObject(catalog['$defs']) ? catalog['$defs'] : {};
  const defs: Record<string, unknown> = {...catalogDefs};
  for (const name of localDefRefs(catalog)) {
    if (!(name in catalogDefs) && name in specDefs) {
      defs[name] = {$ref: `${COMMON_TYPES_DOCUMENT}#/$defs/${escapeJsonPointerToken(name)}`};
    }
  }
  // A Set visits the names added while it is iterated.
  for (const name of referenced) {
    if (name in catalogDefs) defs[name] = withoutEnvelopeFields(catalogDefs[name], referenced);
  }
  defs['anyComponent'] = envelope.$defs['anyComponent'];
  defs['anyFunction'] = atLeastV10 ? V10_ANY_FUNCTION : V09_ANY_FUNCTION;
  const document: Record<string, unknown> = {...catalog, components, $defs: defs};

  const documents: Record<string, JsonSchema> = {
    [CATALOG_DOCUMENT]: document,
    [COMMON_TYPES_DOCUMENT]: commonTypes,
  };
  const byName: Record<string, JsonSchema> = {
    [CATALOG_DOCUMENT]: document,
    [COMMON_TYPES_DOCUMENT]: commonTypes,
  };
  for (const [name, own] of Object.entries(supplied)) {
    if (name === CATALOG_DOCUMENT || name === COMMON_TYPES_DOCUMENT) continue;
    documents[name] = own;
    byName[name] = own;
  }
  for (const name of externalDocuments([catalog, specCommonTypes, ...Object.values(supplied)])) {
    const own = byName[basename(name)];
    if (own === undefined) continue;
    documents[name] = own;
    // The relative names inside a document resolve against the URI it is
    // registered under, so register the other document next to it as well.
    for (const [sibling, other] of Object.entries(byName)) {
      try {
        documents[new URL(sibling, name).href] = other;
      } catch {
        // `name` is relative: its siblings are the bare names.
      }
    }
  }
  return documents;
}

/**
 * Whether a property name is one of the component envelope fields (`id`,
 * `component`, `@catalogId`), which route a component rather than configure it.
 * The validation schema leaves them out of a component for the same reason, and
 * `PayloadValidator` strips them before parsing a component.
 *
 * @param propName Property name to check.
 * @returns True if the property belongs to the envelope rather than the component.
 */
function isEnvelopeField(propName: string): boolean {
  // A bare `catalogId` a component declares is its own property: below v1.0
  // the protocol has no per-component catalog, and from v1.0 the envelope
  // field is `@catalogId`.
  return propName === 'id' || propName === 'component' || propName === '@catalogId';
}

/**
 * Resolves a JSON Pointer within a root JSON document.
 *
 * Follows RFC 6901 pointer unescaping (~1 -> /, ~0 -> ~).
 *
 * @param rootDoc Root JSON document to resolve within.
 * @param pointer RFC 6901 JSON pointer string.
 * @returns The resolved document subtree, or undefined if not found.
 */
export function resolveJsonPointer(
  rootDoc: Record<string, unknown>,
  pointer: string,
): Record<string, unknown> | undefined {
  if (!pointer.startsWith('#/')) return undefined;
  const segments = pointer
    .slice(2)
    .split('/')
    .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));

  let curr: unknown = rootDoc;
  for (const seg of segments) {
    if (curr && typeof curr === 'object' && seg in curr) {
      curr = (curr as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return typeof curr === 'object' && curr !== null ? (curr as Record<string, unknown>) : undefined;
}

/**
 * Serializes a value to canonical JSON with deterministically sorted object keys.
 *
 * Produces identical strings for semantically equivalent values regardless of
 * object property insertion order.
 *
 * @param val Value to serialize.
 * @returns Deterministic JSON string representation.
 */
export function canonicalJsonStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map(canonicalJsonStringify).join(',')}]`;
  }
  const keys = Object.keys(val as Record<string, unknown>).sort();
  const entries = keys.map(
    k => `${JSON.stringify(k)}:${canonicalJsonStringify((val as Record<string, unknown>)[k])}`,
  );
  return `{${entries.join(',')}}`;
}

/**
 * Checks whether an object schema represents a shorthand parameter map (a map
 * of parameter names to subschemas), rather than a full JSON Schema object or
 * reference combinator.
 */
export function isShorthandParameterMap(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return false;
  }
  const s = schema as Record<string, unknown>;
  return (
    Object.keys(s).length > 0 &&
    s.properties === undefined &&
    typeof s.type !== 'string' &&
    !('$ref' in s) &&
    !('allOf' in s) &&
    !('oneOf' in s) &&
    !('anyOf' in s) &&
    !('not' in s) &&
    Object.values(s).every(v => v !== null && (typeof v === 'object' || typeof v === 'boolean'))
  );
}

/**
 * Extracts declared parameter names from a function's argument schema,
 * including those of `allOf`, `anyOf` and `oneOf` members and `$ref` targets.
 */
export function functionParameterNames(
  schema: unknown,
  rootDoc?: Record<string, unknown>,
): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [];
  }
  const s = schema as Record<string, unknown>;
  const names: string[] = [];
  const visited = new Set<string>();

  const extractProperties = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const n = node as Record<string, unknown>;
    if (typeof n.$ref === 'string' && rootDoc && n.$ref.startsWith('#/')) {
      if (!visited.has(n.$ref)) {
        visited.add(n.$ref);
        const target = resolveJsonPointer(rootDoc, n.$ref);
        if (target) {
          extractProperties(target);
        }
      }
    }
    if (
      n.properties &&
      typeof n.properties === 'object' &&
      n.properties !== null &&
      !Array.isArray(n.properties)
    ) {
      names.push(...Object.keys(n.properties as Record<string, unknown>));
    }
    for (const combinator of [n.allOf, n.anyOf, n.oneOf]) {
      if (Array.isArray(combinator)) {
        for (const member of combinator) {
          extractProperties(member);
        }
      }
    }
  };

  if (
    (s.properties &&
      typeof s.properties === 'object' &&
      s.properties !== null &&
      !Array.isArray(s.properties)) ||
    Array.isArray(s.allOf) ||
    Array.isArray(s.anyOf) ||
    Array.isArray(s.oneOf) ||
    typeof s.$ref === 'string'
  ) {
    extractProperties(s);
    return names;
  }

  if (isShorthandParameterMap(s)) {
    return Object.keys(s);
  }

  return [];
}

/**
 * Returns the schema of the arguments of a function a `functions` map
 * defines: its call schema's `args`, a bare map of argument schemas with the
 * object keywords beside it, or, for a definition that is not a call schema,
 * the definition itself.
 *
 * @param d The function's definition.
 */
function functionArgsSchema(
  d: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  let props =
    d.properties &&
    typeof d.properties === 'object' &&
    d.properties !== null &&
    !Array.isArray(d.properties)
      ? (d.properties as Record<string, unknown>)
      : undefined;
  if (!props?.args && Array.isArray(d.allOf)) {
    for (const member of d.allOf) {
      if (
        member &&
        typeof member === 'object' &&
        !Array.isArray(member) &&
        (member as Record<string, unknown>).properties &&
        typeof (member as Record<string, unknown>).properties === 'object' &&
        (member as Record<string, unknown>).properties !== null &&
        !Array.isArray((member as Record<string, unknown>).properties)
      ) {
        props = {
          ...props,
          ...((member as Record<string, unknown>).properties as Record<string, unknown>),
        };
      }
    }
  }
  let argsSchema = props?.args ?? d.args ?? d.parameters;
  if (!argsSchema && props && !('call' in props) && !('@call' in props) && !('function' in props)) {
    argsSchema = d;
  } else if (isShorthandParameterMap(argsSchema)) {
    argsSchema = shorthandObject(argsSchema as Record<string, unknown>, d);
  }
  return argsSchema && typeof argsSchema === 'object' && !Array.isArray(argsSchema)
    ? (argsSchema as Record<string, unknown>)
    : undefined;
}

/**
 * Extracts permitted definition names matching a reference prefix from a `oneOf` array.
 *
 * @param oneOf Array of reference schema objects from `anyComponent` or `anyFunction`.
 * @param prefix Prefix to match and strip, such as `#/components/` or `#/functions/`.
 * @returns Set of unescaped allowed names, or undefined if `oneOf` is not an array.
 */
function extractPermittedNames(oneOf: unknown, prefix: string): Set<string> | undefined {
  if (!Array.isArray(oneOf)) return undefined;
  const permitted = new Set<string>();
  for (const item of oneOf) {
    if (typeof item?.$ref === 'string' && item.$ref.startsWith(prefix)) {
      const rawName = item.$ref.slice(prefix.length);
      const unescapedName = rawName.replace(/~([01])/g, (_: string, p1: string) =>
        p1 === '1' ? '/' : '~',
      );
      permitted.add(unescapedName);
    }
  }
  return permitted;
}

/**
 * Whether a v1.0 catalog may use `ref` as a `$ref` target.
 *
 * A v1.0 catalog may reference its own document, through a local reference
 * (`#/...`) or the `catalog.json` envelope placeholder, and `common_types.json`,
 * by a relative or absolute URI.
 *
 * @param ref The `$ref` value.
 * @returns Whether the reference is allowed.
 */
function isSupportedV10Ref(ref: string): boolean {
  if (ref.startsWith('#')) return true;
  const hashIndex = ref.indexOf('#');
  const documentPart = hashIndex === -1 ? ref : ref.slice(0, hashIndex);
  if (documentPart === 'catalog.json') return true;
  return documentPart.split('/').pop() === 'common_types.json';
}

/**
 * Escapes a key as an RFC 6901 JSON Pointer reference token.
 */
function escapeJsonPointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Checks that every `$ref` of a v1.0 catalog document targets the document
 * itself or `common_types.json`.
 *
 * Walks the whole document, including components, functions and `$defs`.
 * References are only inspected, never resolved or fetched.
 *
 * @param node The document, or a value nested in it.
 * @param pointer JSON Pointer of `node` within the document.
 * @throws {A2uiCatalogError} If a `$ref` targets any other document, such as
 *   another catalog.
 */
function assertSupportedV10Refs(node: unknown, pointer: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => assertSupportedV10Refs(item, `${pointer}/${index}`));
    return;
  }
  if (!isPlainObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const childPointer = `${pointer}/${escapeJsonPointerToken(key)}`;
    if (key === '$ref' && typeof value === 'string' && !isSupportedV10Ref(value)) {
      throw new A2uiCatalogError(
        `Unsupported external $ref '${value}' at ${childPointer}: a v1.0 catalog may only ` +
          'reference its own components and functions (#/...) or common_types.json.',
      );
    }
    assertSupportedV10Refs(value, childPointer);
  }
}

/**
 * A v1.0 component's definition, closed the way the protocol's `Component`
 * closes it (with `unevaluatedProperties: false`, unless the definition
 * decides that itself): a v1.0 catalog writes its components open, and a
 * component object may carry no key its definition does not evaluate. Unlike the
 * protocol's `Component`, it leaves `ComponentCommon` out: the component's
 * envelope fields and the mixins its definition does not declare are
 * validated on their own (see `PayloadValidator`): an `@checks` on a component
 * that is not Checkable is rejected there (`validateEnvelopeMixins`, the
 * `'checks'` case in `validation/payload-validator.ts`), so leaving the mixins
 * out of the closure accepts the same component objects the spec does.
 * Before v1.0 a catalog closes its components itself, and the definition is
 * used as written.
 */
function closedComponent(definition: unknown): unknown {
  return isPlainObject(definition) && !('unevaluatedProperties' in definition)
    ? {...definition, unevaluatedProperties: false}
    : definition;
}

/**
 * Parses the function definitions of a catalog document.
 *
 * Checks the UAX #31 identifiers and the user activation rule of a v1.0
 * catalog, and leaves out functions `anyFunction.oneOf` does not list.
 */
function parseFunctionDefinitions(
  rawFunctions: unknown,
  rootDoc: Record<string, unknown>,
  schemaOf: (name: string, args: unknown) => () => CatalogSchema,
  permittedNames: Set<string> | undefined,
  atLeastV10: boolean,
): FunctionApi[] {
  const result: FunctionApi[] = [];
  if (!rawFunctions) return result;

  /** Validates a function's own name and its declared argument names. */
  const assertFunctionIdentifiers = (name: string, paramNames: string[]): void => {
    if (!atLeastV10) return;
    assertUax31Identifier(name, `function identifier: '${name}'`);
    for (const argName of paramNames) {
      assertUax31Identifier(argName, `argument identifier: '${argName}' in function '${name}'`);
    }
  };

  /**
   * Rejects requiresUserActivation=true with callers other than rendererOnly.
   * The rule exists only in the v1.0 catalog_definition.json.
   */
  const assertUserActivationCallers = (entry: FunctionApi): void => {
    if (!atLeastV10) return;
    if (
      entry.requiresUserActivation === true &&
      entry.allowedCallers !== undefined &&
      entry.allowedCallers !== 'rendererOnly'
    ) {
      throw new A2uiCatalogError(
        `Function '${entry.name}' declares requiresUserActivation=true with allowedCallers='${entry.allowedCallers}'; requiresUserActivation=true requires allowedCallers='rendererOnly'.`,
      );
    }
  };

  if (Array.isArray(rawFunctions)) {
    for (const fn of rawFunctions) {
      if (fn && typeof fn === 'object' && typeof fn.name === 'string') {
        assertFunctionIdentifiers(fn.name, functionParameterNames(fn.parameters, rootDoc));
        const parameters = isShorthandParameterMap(fn.parameters)
          ? shorthandObject(fn.parameters as Record<string, unknown>)
          : fn.parameters;
        const entry = new JsonFunctionApi(
          fn.name,
          fn as Record<string, unknown>,
          schemaOf(fn.name, parameters),
          documentDefsOf(rootDoc),
        );
        assertUserActivationCallers(entry);
        if (permittedNames && !permittedNames.has(fn.name)) continue;
        result.push(entry);
      }
    }
    return result;
  }

  if (isPlainObject(rawFunctions)) {
    for (const [name, defn] of Object.entries(rawFunctions)) {
      const rawDefn = isPlainObject(defn) ? defn : {};
      const argsSchema = functionArgsSchema(rawDefn);
      assertFunctionIdentifiers(name, functionParameterNames(argsSchema, rootDoc));
      if (!defn || typeof defn !== 'object') continue;
      const entry = new JsonFunctionApi(
        name,
        rawDefn,
        schemaOf(name, argsSchema),
        documentDefsOf(rootDoc),
      );
      assertUserActivationCallers(entry);
      if (permittedNames && !permittedNames.has(name)) continue;
      result.push(entry);
    }
  }
  return result;
}

/**
 * Parses the component definitions of a catalog document.
 *
 * Checks the UAX #31 identifiers and the metadata of a v1.0 catalog, and
 * leaves out components `anyComponent.oneOf` does not list.
 */
function parseCatalogComponents(
  componentsMap: Record<string, unknown>,
  schemaOf: (name: string) => () => CatalogSchema,
  atLeastV10: boolean,
  permittedNames: Set<string> | undefined,
  defs: Readonly<Record<string, unknown>> | undefined,
): ComponentApi[] {
  const components: ComponentApi[] = [];
  for (const [name, rawCompSchema] of Object.entries(componentsMap)) {
    const rawComp = (rawCompSchema as Record<string, unknown>) || {};
    if (atLeastV10) {
      assertUax31Identifier(name, `component identifier: '${name}'`);
      const props = rawComp.properties;
      if (props && typeof props === 'object') {
        for (const propName of Object.keys(props as Record<string, unknown>)) {
          assertUax31Identifier(
            propName,
            `property identifier: '${propName}' in component '${name}'`,
          );
        }
      }
      const rawMeta = rawComp.metadata;
      if (rawMeta !== undefined) {
        try {
          validateMetadata(rawMeta);
        } catch (err) {
          throw new A2uiCatalogError(err instanceof Error ? err.message : String(err));
        }
      }
    }
    if (permittedNames && !permittedNames.has(name)) continue;
    components.push(new JsonComponentApi(name, rawComp, schemaOf(name), defs));
  }
  return components;
}

/**
 * The theme a catalog document declares: under `theme`, `themeSchema`,
 * `styles` (v0.8) or `$defs.theme`, as an object schema or a bare map of
 * theme property schemas. As JSON Schema itself has it, a theme is open
 * unless its author closes it.
 */
function themeDefinition(catalogSchema: Record<string, unknown>): unknown {
  const defs = isPlainObject(catalogSchema.$defs) ? catalogSchema.$defs : undefined;
  const rawTheme =
    catalogSchema.theme ?? catalogSchema.themeSchema ?? catalogSchema.styles ?? defs?.theme;
  if (!isPlainObject(rawTheme)) return undefined;
  return 'properties' in rawTheme || 'allOf' in rawTheme || rawTheme.type === 'object'
    ? rawTheme
    : {type: 'object', properties: rawTheme};
}

/**
 * Parses a raw A2UI catalog document into its entries and document-level
 * fields, for `Catalog.fromJson`.
 *
 * Each entry keeps its definition as written, and its schema validates
 * against it with `opts.validator`: a component's properties against its
 * definition (from v1.0 closed as {@link closedComponent} describes), a
 * function's arguments against the schema of its arguments, and the theme
 * against the theme's schema, each with the documents described in
 * {@link entryDocuments}. Every schema is compiled while the catalog loads;
 * discovery reads it where it sits in the catalog document.
 *
 * @param inputSchema Raw catalog schema or capabilities definition object. It
 *   is copied first and never referenced afterwards.
 * @param protocolVersion Protocol version of the catalog. When given, it takes
 *   precedence over the `protocolVersion` the schema declares and selects the
 *   version's loading rules; the declared version is still kept as written.
 *   Catalog schemas published before v1.0 omit `protocolVersion`; when
 *   neither the caller nor the schema supplies it, `DEFAULT_PROTOCOL_VERSION`
 *   applies.
 * @param catalogIdOverride Catalog ID to use instead of the one the schema
 *   declares. The schema itself is kept as written.
 * @param opts The validator the entries validate with.
 * @returns Parsed catalog fields ready to construct a `Catalog` instance.
 * @throws {A2uiConfigurationError} If `opts.validator` is missing, or it
 *   can't compile an entry's schema (the error names the entry).
 * @throws {Error} If the catalog ID is missing or not a string.
 * @throws {A2uiCatalogError} If a v1.0+ catalog has a `$ref` to a document
 *   other than itself or `common_types.json`, such as another catalog, or an
 *   identifier, metadata or user activation rule is invalid.
 */
export function parseCatalogSchema(
  inputSchema: Record<string, unknown>,
  protocolVersion: string | undefined,
  catalogIdOverride: string | undefined,
  opts: FromJsonOptions,
): ParsedCatalogSchema {
  const validator = opts?.validator;
  if (typeof validator?.compile !== 'function') {
    throw noValidatorError(
      'Pass one to Catalog.fromJson(document, protocolVersion, catalogId, {validator}), such as createAjvValidator() from @a2ui/validator-ajv.',
    );
  }
  // Everything the catalog keeps comes from this copy, so mutating the input
  // afterwards cannot change it.
  const catalogSchema = deepCopyJson(inputSchema);
  const catalogId =
    catalogIdOverride ?? catalogSchema.catalogId ?? catalogSchema.$id ?? catalogSchema.id;
  if (!catalogId || typeof catalogId !== 'string') {
    throw new Error("Catalog ID must be specified via catalog metadata ('catalogId' or '$id').");
  }

  const defs = catalogSchema.$defs as Record<string, unknown> | undefined;
  const anyComp = defs?.anyComponent as Record<string, unknown> | undefined;
  const permittedNames = extractPermittedNames(anyComp?.oneOf, '#/components/');

  const resolvedVersion =
    protocolVersion ??
    (catalogSchema.protocolVersion as string | undefined) ??
    DEFAULT_PROTOCOL_VERSION;
  const atLeastV10 = isAtLeastVersion(resolvedVersion, '1.0');
  if (atLeastV10) {
    // Before anything reads the entries, so no unsupported reference is ever
    // followed.
    assertSupportedV10Refs(catalogSchema, '');
  }

  // The copy is frozen: the entries' definitions and the document fields
  // refer into it.
  deepFreeze(catalogSchema);
  let entryDocs: Record<string, JsonSchema> | undefined;
  const supplied = opts.documents ? deepCopyJson(opts.documents as Record<string, unknown>) : {};
  const documentsFor = () =>
    (entryDocs ??= entryDocuments(
      catalogSchema,
      resolvedVersion,
      supplied as Record<string, JsonSchema>,
    ));
  /**
   * The schema of an entry whose JSON Schema is `node` of the catalog
   * document (or an object made of its nodes), as `entryDocuments` has it:
   * the engine compiles a copy that names the catalog document by name,
   * discovery reads `node` in place.
   */
  const schemaOf =
    (what: string, node: () => unknown, close?: (node: unknown) => unknown) =>
    (): CatalogSchema => {
      const documents = documentsFor();
      const at = node();
      return namedJsonSchema(
        rebased(close ? close(at) : at) as JsonSchema,
        validator,
        {defs: documents},
        `${what} of catalog '${catalogId}'`,
        {node: at as JsonSchema, doc: {root: documents[CATALOG_DOCUMENT], defs: documents}},
      );
    };

  const componentsMap = (catalogSchema.components as Record<string, unknown>) ?? {};
  const components = parseCatalogComponents(
    componentsMap,
    name =>
      // The definition as the entry documents have it, without the envelope fields.
      schemaOf(
        `Component '${name}'`,
        () => {
          const document = documentsFor()[CATALOG_DOCUMENT] as Record<string, unknown>;
          return (document['components'] as Record<string, unknown>)[name];
        },
        atLeastV10 ? closedComponent : undefined,
      ),
    atLeastV10,
    permittedNames,
    documentDefsOf(catalogSchema),
  );

  const anyFunc = defs?.anyFunction as Record<string, unknown> | undefined;
  const permittedFunctionNames = extractPermittedNames(anyFunc?.oneOf, '#/functions/');
  const functions = parseFunctionDefinitions(
    catalogSchema.functions,
    catalogSchema,
    (name, args) =>
      schemaOf(`Function '${name}'`, () => (isPlainObject(args) ? args : {type: 'object'})),
    permittedFunctionNames,
    atLeastV10,
  );

  const theme = themeDefinition(catalogSchema);
  const themeSchema = theme === undefined ? undefined : schemaOf('The theme', () => theme)();

  // Every entry compiles now, so a catalog the engine can't use fails to
  // load, naming the entry, rather than on the first message that uses it.
  for (const entry of [...components, ...functions]) void entry.schema;

  return {
    id: catalogId,
    protocolVersion: resolvedVersion,
    components,
    functions,
    themeSchema,
    ...readDocumentFields(catalogSchema, components, functions),
  };
}

/** Top-level keys of a catalog document that `CatalogDocumentOptions` models. */
const DOCUMENT_STRING_FIELDS = {
  '$schema': 'schemaUri',
  '$id': 'schemaId',
  'title': 'title',
  'description': 'description',
  'instructions': 'instructions',
} as const;

/** Top-level keys of a catalog document that `Catalog` models besides the string fields. */
const DOCUMENT_STRUCTURE_FIELDS = new Set(['protocolVersion', 'catalogId', 'components']);

/** The named `$defs` of a (frozen) catalog document, if it has any. */
function documentDefsOf(
  document: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  return isPlainObject(document['$defs']) ? document['$defs'] : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether `actual` is the union a catalog computes, ignoring object key order.
 */
function isComputedUnion(actual: unknown, computed: Record<string, unknown>): boolean {
  return canonicalJsonStringify(actual) === canonicalJsonStringify(computed);
}

/**
 * Reads the document-level fields of a catalog document into the model fields
 * `Catalog` keeps.
 *
 * The `anyComponent` and `anyFunction` unions become flags when they list
 * exactly the loaded entries, in order, as `toJson` computes them; a union of
 * any other form stays in `defs` as written. Keys the model has no field for
 * are kept in `extensionFields`.
 *
 * @param document The frozen catalog document.
 * @param components The components loaded from it.
 * @param functions The functions loaded from it.
 */
function readDocumentFields(
  document: Readonly<Record<string, unknown>>,
  components: readonly ComponentApi[],
  functions: readonly FunctionApi[],
): CatalogDocumentOptions {
  const fields: CatalogDocumentOptions = {};
  const extensionFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (key in DOCUMENT_STRING_FIELDS && typeof value === 'string') {
      fields[DOCUMENT_STRING_FIELDS[key as keyof typeof DOCUMENT_STRING_FIELDS]] = value;
    } else if (key === 'protocolVersion' && typeof value === 'string') {
      fields.declaredProtocolVersion = value;
    } else if (key === 'functions' && (Array.isArray(value) || isPlainObject(value))) {
      fields.functionsLayout = Array.isArray(value) ? 'list' : 'map';
    } else if (key === '$defs' && isPlainObject(value)) {
      const anyComponent = isComputedUnion(
        value['anyComponent'],
        buildComponentUnion(components.map(c => c.name)),
      );
      const anyFunction = isComputedUnion(
        value['anyFunction'],
        buildFunctionUnion(functions.map(f => f.name)),
      );
      fields.unions = {anyComponent, anyFunction};
      const defs: Record<string, unknown> = {};
      for (const [name, def] of Object.entries(value)) {
        if ((name === 'anyComponent' && anyComponent) || (name === 'anyFunction' && anyFunction)) {
          continue;
        }
        defs[name] = def;
      }
      fields.defs = Object.freeze(defs);
    } else if (
      !DOCUMENT_STRUCTURE_FIELDS.has(key) ||
      (key === 'components' && !isPlainObject(value))
    ) {
      extensionFields[key] = value;
    }
  }
  fields.declaredProtocolVersion ??= null;
  fields.declaresCatalogId = typeof document['catalogId'] === 'string';
  fields.declaresComponents = isPlainObject(document['components']);
  fields.unions ??= {anyComponent: false, anyFunction: false};
  if (Object.keys(extensionFields).length > 0) {
    fields.extensionFields = Object.freeze(extensionFields);
  }
  return fields;
}
