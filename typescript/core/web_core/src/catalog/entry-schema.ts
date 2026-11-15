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

import type {StandardSchemaV1} from '@standard-schema/spec';

import {isAtLeastVersion} from '../common/semver.js';
import {A2uiConfigurationError} from '../errors.js';
import {assertSync} from '../schema-engine/issues.js';
import {
  isJsonBackedSchema,
  jsonSchemaCursor,
  jsonSchemaDocuments,
} from '../schema-engine/from-json-schema.js';
import type {SchemaCursor} from '../schema-engine/nav.js';
import type {CatalogSchema, JsonSchema, JsonSchemaValidator} from '../schema-engine/types.js';
import V09CommonTypes from '../v0_9/schemas/common_types.json' with {type: 'json'};
import V091CommonTypes from '../v0_9_1/schemas/common_types.json' with {type: 'json'};
import V09EnvelopeCatalog from '../v0_9/envelope_catalog.json' with {type: 'json'};
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import V10EnvelopeCatalog from '../v1_0/envelope_catalog.json' with {type: 'json'};
import {bindUnboundSchema, catalogValidator} from './catalog-validator.js';

/**
 * The schema a catalog entry is written with: a {@link CatalogSchema}, that
 * is, a synchronous Standard Schema that implements Standard JSON Schema.
 */
export type AuthoredSchema = CatalogSchema<any>;

/** A catalog entry's schema as registration prepared it. */
export interface EntrySchema {
  /** The schema to validate with. */
  readonly schema: CatalogSchema;
  /** The schema's JSON Schema, from `~standard.jsonSchema.input`. */
  readonly jsonSchema: JsonSchema;
  /**
   * The JSON Schema discovery reads (bindings, child references, known
   * keys, dynamic booleans, the component envelope's mixin layout), with
   * its referenced documents.
   */
  readonly cursor: SchemaCursor;
}

/** The catalog fields an entry's schema document depends on. */
export interface EntrySchemaContext {
  readonly protocolVersion?: string;
  readonly defs?: Readonly<Record<string, unknown>>;
  /**
   * The validator a plain JSON Schema (an agent function's, `@index`'s)
   * compiles with. When absent, the one bound to the context, if it is a
   * catalog (see `catalogValidator`).
   */
  readonly validator?: JsonSchemaValidator;
}

const COMMON_TYPES = 'common_types.json';
const CATALOG = 'catalog.json';

/**
 * The common types document for a protocol version. v0.8 ships none; its
 * catalogs reference child ids structurally, so v0.9's stands in for the
 * `ComponentId`/`ChildList` targets a converted schema is written as.
 */
export function commonTypesFor(protocolVersion: string | undefined): JsonSchema {
  if (!protocolVersion || isAtLeastVersion(protocolVersion, '1.0')) {
    return V10CommonTypes as JsonSchema;
  }
  if (isAtLeastVersion(protocolVersion, '0.9.1')) return V091CommonTypes as JsonSchema;
  return V09CommonTypes as JsonSchema;
}

interface Converted {
  readonly schema: CatalogSchema;
  readonly jsonSchema: JsonSchema;
}

const converted = new WeakMap<object, Converted>();

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Whether `value` looks like a zod schema without Standard JSON Schema (such
 * as any zod 3 schema), which web_core cannot read.
 */
function isZodWithoutJsonSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_def' in value &&
    typeof (value as {safeParse?: unknown}).safeParse === 'function' &&
    typeof (value as {'~standard'?: {jsonSchema?: unknown}})['~standard']?.jsonSchema !== 'object'
  );
}

/**
 * Prepares an authored schema for use: checks that the schema is a
 * synchronous Standard Schema that implements Standard JSON Schema, and
 * converts it to JSON Schema once. Cached per schema object.
 *
 * @param authored The schema as the entry was written.
 * @param what The entry, for error messages (e.g. `Component 'Button'`).
 * @throws {A2uiConfigurationError} If the schema is a zod schema without
 *   Standard JSON Schema, is not a
 *   Standard Schema with JSON Schema, its conversion throws, or its
 *   validation is asynchronous.
 */
export function prepareSchema(authored: AuthoredSchema, what: string): Converted {
  const cached = converted.get(authored);
  if (cached) return cached;
  if (isZodWithoutJsonSchema(authored)) {
    throw new A2uiConfigurationError(
      `${what}: its schema is a zod schema without Standard JSON Schema (\`~standard.jsonSchema\`), which web_core cannot read. Wrap a zod 3 schema with fromZod3() from @a2ui/schema-zod3, or pass a Standard JSON Schema such as fromJsonSchema(schema, validator).`,
    );
  }
  const schema: CatalogSchema = authored;
  const standard = (schema as Partial<CatalogSchema> | undefined)?.['~standard'];
  if (typeof standard?.validate !== 'function') {
    throw new A2uiConfigurationError(
      `${what}: its schema is not a Standard Schema (it has no '~standard.validate').`,
    );
  }
  if (typeof standard.jsonSchema?.input !== 'function') {
    throw new A2uiConfigurationError(
      `${what}: its schema does not implement Standard JSON Schema (it has no '~standard.jsonSchema.input'), so web_core cannot read it.`,
    );
  }
  let jsonSchema: JsonSchema;
  try {
    jsonSchema = standard.jsonSchema.input({target: 'draft-2020-12'}) as JsonSchema;
  } catch (err: unknown) {
    throw new A2uiConfigurationError(
      `${what}: its schema could not be converted to JSON Schema: ${message(err)}`,
    );
  }
  // An asynchronous validator returns a Promise for any value; probe one. A
  // JSON-backed schema is synchronous by construction (a JsonSchemaValidator
  // compiles to a synchronous function), so it is not probed.
  if (!isJsonBackedSchema(schema)) {
    let probe: unknown;
    try {
      probe = standard.validate({});
    } catch {
      probe = undefined;
    }
    assertSync(probe, what);
  }
  const result: Converted = {schema, jsonSchema};
  converted.set(authored, result);
  return result;
}

/** The document parts (before `#`) of every cross-document `$ref` in `value`. */
export function externalDocuments(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) externalDocuments(item, found);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') {
        const hash = item.indexOf('#');
        const document = hash === -1 ? item : item.slice(0, hash);
        if (document) found.add(document);
      } else {
        externalDocuments(item, found);
      }
    }
  }
  return found;
}

/** The last path segment of a document reference, e.g. `common_types.json`. */
export function basename(document: string): string {
  return document.slice(document.lastIndexOf('/') + 1);
}

/**
 * The referenced documents of a schema: `common_types.json` and `catalog.json`,
 * under any base (such as `https://a2ui.org/specification/v0_9/common_types.json`).
 * The common types are the protocol version's; the catalog is the catalog's
 * `$defs`. Any other document is left out, so a `$ref` into it fails loudly
 * where discovery follows it, rather than reading the wrong document.
 */
function referencedDocuments(
  value: unknown,
  commonTypes: JsonSchema,
  catalogDefs: Readonly<Record<string, unknown>> | undefined,
): Record<string, JsonSchema> {
  const catalog: JsonSchema = {$defs: {...catalogDefs}};
  const defs: Record<string, JsonSchema> = {[COMMON_TYPES]: commonTypes, [CATALOG]: catalog};
  for (const document of externalDocuments(value)) {
    const name = basename(document);
    if (name === COMMON_TYPES) defs[document] = commonTypes;
    else if (name === CATALOG) defs[document] = catalog;
  }
  return defs;
}

const NO_DEFS = {};
const entrySchemas = new WeakMap<object, WeakMap<object, WeakMap<object, EntrySchema>>>();

function cachedEntrySchema(
  entry: object,
  commonTypes: object,
  defs: object,
  build: () => EntrySchema,
): EntrySchema {
  let byCommonTypes = entrySchemas.get(entry);
  if (!byCommonTypes) {
    byCommonTypes = new WeakMap();
    entrySchemas.set(entry, byCommonTypes);
  }
  let byDefs = byCommonTypes.get(commonTypes);
  if (!byDefs) {
    byDefs = new WeakMap();
    byCommonTypes.set(commonTypes, byDefs);
  }
  let result = byDefs.get(defs);
  if (!result) {
    result = build();
    byDefs.set(defs, result);
  }
  return result;
}

/**
 * Returns a component's or function's schema as registration prepared it.
 *
 * `Catalog` calls this for every entry when it is constructed, so a schema
 * that can't be used fails there, naming the entry; later calls return the
 * cached result.
 *
 * Discovery reads the schema's JSON Schema, with its own root as the local
 * document; an entry `Catalog.fromJson` loaded is read where it sits in the
 * catalog document instead. A JSON-backed schema (`fromJsonSchema`) brings
 * the documents it validates with; for any other document a schema
 * references, the protocol version's common types and the catalog's
 * `$defs` stand in.
 *
 * @param entry The component or function.
 * @param kind Which of the two `entry` is, for error messages.
 * @param context The catalog the entry belongs to.
 * @returns The prepared schema, or `undefined` if the entry has none.
 * @throws {A2uiConfigurationError} If the entry's schema can't be used (see
 *   {@link prepareSchema}).
 */
export function entrySchema(
  entry: {readonly name: string; readonly schema?: AuthoredSchema},
  kind: 'component' | 'function',
  context?: EntrySchemaContext,
): EntrySchema | undefined {
  if (!entry.schema) return undefined;
  const commonTypes = commonTypesFor(context?.protocolVersion) as object;
  const defs = context?.defs ?? NO_DEFS;
  const prepared = cachedEntrySchema(entry, commonTypes, defs, () => {
    const what = `${kind === 'component' ? 'Component' : 'Function'} '${entry.name}'`;
    const {schema, jsonSchema} = prepareSchema(entry.schema!, what);
    const cursor: SchemaCursor = jsonSchemaCursor(schema) ?? {
      node: jsonSchema,
      doc: {
        root: jsonSchema,
        defs: {
          ...referencedDocuments(jsonSchema, commonTypes as JsonSchema, context?.defs),
          ...jsonSchemaDocuments(schema),
        },
      },
    };
    return {schema, jsonSchema, cursor};
  });
  const validator = context?.validator ?? catalogValidator(context);
  if (!validator) return prepared;
  const schema = bindUnboundSchema(prepared.schema, validator, compileDocuments(prepared, context));
  return schema === prepared.schema ? prepared : {...prepared, schema};
}

const compileDocs = new WeakMap<EntrySchema, Record<string, JsonSchema>>();

/**
 * The documents a plain JSON Schema entry compiles with: its referenced
 * documents, with the catalog document carrying the protocol version's
 * envelope unions (`anyFunction`, `anyComponent`) that the common types
 * reference, besides the catalog's own `$defs`.
 */
function compileDocuments(
  prepared: EntrySchema,
  context: EntrySchemaContext | undefined,
): Record<string, JsonSchema> {
  let docs = compileDocs.get(prepared);
  if (!docs) {
    const envelope = (
      !context?.protocolVersion || isAtLeastVersion(context.protocolVersion, '1.0')
        ? V10EnvelopeCatalog
        : V09EnvelopeCatalog
    ) as {$defs: Record<string, unknown>};
    const catalog: JsonSchema = {$defs: {...envelope.$defs, ...context?.defs}};
    docs = {};
    for (const [name, doc] of Object.entries(prepared.cursor.doc.defs)) {
      docs[name] = basename(name) === CATALOG ? catalog : doc;
    }
    compileDocs.set(prepared, docs);
  }
  return docs;
}

/**
 * Validates `value` with a prepared schema.
 *
 * @throws {A2uiConfigurationError} If the schema validates asynchronously.
 */
export function validateWith(
  schema: CatalogSchema,
  value: unknown,
  what: string,
): StandardSchemaV1.Result<unknown> {
  return assertSync(schema['~standard'].validate(value), what);
}

/**
 * A copy of the JSON Schema of an authored schema, without `$schema`, for the
 * catalog serializers; `undefined` for a missing schema.
 *
 * @throws {A2uiConfigurationError} If the schema can't be used (see
 *   {@link prepareSchema}).
 */
export function schemaJson(
  schema: AuthoredSchema | undefined,
): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  const {jsonSchema} = prepareSchema(schema, 'Catalog entry');
  const json = typeof jsonSchema === 'boolean' ? (jsonSchema ? {} : {not: {}}) : jsonSchema;
  const {$schema: _schema, ...rest} = structuredClone(json);
  return rest;
}

/**
 * The schema cursor web_core caches for a component registered in a catalog,
 * for building a binder:
 *
 * ```ts
 * const binder = new GenericBinder(context, componentSchemaCursor(catalog, 'Text')!);
 * ```
 *
 * @param catalog The catalog the component is registered in.
 * @param componentName The component's name, such as `'Text'`.
 * @returns The cursor, or `undefined` if the catalog has no such component or
 *   it has no schema.
 */
export function componentSchemaCursor(
  catalog: {
    readonly protocolVersion?: string;
    readonly defs?: Readonly<Record<string, unknown>>;
    readonly components: ReadonlyMap<
      string,
      {readonly name: string; readonly schema?: AuthoredSchema}
    >;
  },
  componentName: string,
): SchemaCursor | undefined {
  const api = catalog.components.get(componentName);
  return api ? entrySchema(api, 'component', catalog)?.cursor : undefined;
}
