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
import type {z} from 'zod';

import {isAtLeastVersion} from '../common/semver.js';
import {A2uiConfigurationError} from '../errors.js';
import {assertSync} from '../schema-engine/issues.js';
import type {SchemaCursor} from '../schema-engine/nav.js';
import type {CatalogSchema, JsonSchema} from '../schema-engine/types.js';
import {fromZod3, isZod3Schema} from '../schema-engine/zod3-adapter.js';
import V09CommonTypes from '../v0_9/schemas/common_types.json' with {type: 'json'};
import V091CommonTypes from '../v0_9_1/schemas/common_types.json' with {type: 'json'};
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import {loadedDefinition} from './json_entries.js';

/**
 * The schema a catalog entry is written with: a {@link CatalogSchema}, or a
 * zod 3 schema, which registration wraps with the internal zod 3 adapter.
 */
// ponytail: `| z.ZodTypeAny` removed with the zod mirrors in Task 11.
export type AuthoredSchema = CatalogSchema<any> | z.ZodTypeAny;

/** A catalog entry's schema as registration prepared it. */
export interface EntrySchema {
  /** The schema to validate with. */
  readonly schema: CatalogSchema;
  /** The schema's JSON Schema, from `~standard.jsonSchema.input`. */
  readonly jsonSchema: JsonSchema;
  /**
   * The JSON Schema discovery reads (bindings, child references, known
   * keys, dynamic booleans), with its referenced documents.
   */
  readonly cursor: SchemaCursor;
  /**
   * The JSON Schema the component envelope's mixin layout is read from: for
   * a component `Catalog.fromJson` loaded, its definition as the document
   * writes it, which declares the envelope keys the derived schema omits;
   * otherwise {@link cursor}.
   */
  // ponytail: one cursor once Task 9 loads entries as JSON Schema.
  readonly layoutCursor: SchemaCursor;
}

/** The catalog fields an entry's schema document depends on. */
export interface EntrySchemaContext {
  readonly protocolVersion?: string;
  readonly defs?: Readonly<Record<string, unknown>>;
}

const COMMON_TYPES = 'common_types.json';

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
 * Prepares an authored schema for use: wraps a zod 3 schema, checks that the
 * schema is a synchronous Standard Schema that implements Standard JSON
 * Schema, and converts it to JSON Schema once. Cached per schema object.
 *
 * @param authored The schema as the entry was written.
 * @param what The entry, for error messages (e.g. `Component 'Button'`).
 * @throws {A2uiConfigurationError} If the schema is not a Standard Schema
 *   with JSON Schema, its conversion throws, or its validation is
 *   asynchronous.
 */
export function prepareSchema(authored: AuthoredSchema, what: string): Converted {
  const cached = converted.get(authored);
  if (cached) return cached;
  const schema: CatalogSchema = isZod3Schema(authored)
    ? fromZod3(authored)
    : (authored as CatalogSchema);
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
  // An asynchronous validator returns a Promise for any value; probe one.
  let probe: unknown;
  try {
    probe = standard.validate({});
  } catch {
    probe = undefined;
  }
  if (probe instanceof Promise) probe.catch(() => {});
  assertSync(probe, what);
  const result: Converted = {schema, jsonSchema};
  converted.set(authored, result);
  return result;
}

/** The document parts (before `#`) of every cross-document `$ref` in `value`. */
function externalDocuments(value: unknown, found = new Set<string>()): Set<string> {
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

/**
 * The referenced documents of a schema: the version's common types, standing
 * in for every document the schema references, as the loader reads them.
 */
function referencedDocuments(value: unknown, commonTypes: JsonSchema): Record<string, JsonSchema> {
  const defs: Record<string, JsonSchema> = {[COMMON_TYPES]: commonTypes};
  for (const document of externalDocuments(value)) defs[document] = commonTypes;
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
 * document; the mixin layout of a component `Catalog.fromJson` loaded is read
 * from its definition, with the catalog's `$defs` as the local document.
 * Either way the protocol version's common types stand in for every other
 * document referenced.
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
  const definition = kind === 'component' ? loadedDefinition(entry) : undefined;
  const defs = definition ? (context?.defs ?? NO_DEFS) : NO_DEFS;
  return cachedEntrySchema(entry, commonTypes, defs, () => {
    const what = `${kind === 'component' ? 'Component' : 'Function'} '${entry.name}'`;
    const {schema, jsonSchema} = prepareSchema(entry.schema!, what);
    const cursor: SchemaCursor = {
      node: jsonSchema,
      doc: {root: jsonSchema, defs: referencedDocuments(jsonSchema, commonTypes as JsonSchema)},
    };
    const layoutCursor: SchemaCursor = definition
      ? {
          node: definition as JsonSchema,
          doc: {
            root: {$defs: context?.defs ?? {}},
            defs: referencedDocuments([definition, context?.defs], commonTypes as JsonSchema),
          },
        }
      : cursor;
    return {schema, jsonSchema, cursor, layoutCursor};
  });
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
 * A copy of the JSON Schema of a schema that is not zod 3, for the catalog
 * serializers, which convert zod 3 schemas themselves; `undefined` for zod 3
 * or a missing schema.
 */
// ponytail: serializers read zod 3 directly until Task 9.
export function nonZodSchemaJson(
  schema: AuthoredSchema | undefined,
): Record<string, unknown> | undefined {
  if (!schema || isZod3Schema(schema)) return undefined;
  const {jsonSchema} = prepareSchema(schema, 'Catalog entry');
  const json = typeof jsonSchema === 'boolean' ? (jsonSchema ? {} : {not: {}}) : jsonSchema;
  const {$schema: _schema, ...rest} = structuredClone(json);
  return rest;
}
