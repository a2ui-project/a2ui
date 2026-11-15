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

/**
 * @fileoverview The JSON Schema validator a catalog's plain JSON Schemas are
 * compiled with.
 *
 * Most entries bring their own compiled schema (`fromJsonSchema`, or an entry
 * `Catalog.fromJson` loaded). A few schemas are written as plain JSON Schema
 * without one: the arguments of an `AgentFunction` built from a JSON Schema
 * object, and the `@index` system function's arguments. Those compile with the
 * validator of the catalog they are used in: the one given to
 * `Catalog.fromJson` or in `CatalogOptions.validator`, else the one of the
 * `MessageProcessor` the catalog is registered with, else the one the
 * catalog's `fromJsonSchema` entries were compiled with.
 */

import type {StandardSchemaV1} from '@standard-schema/spec';

import {A2uiConfigurationError, noValidatorError} from '../errors.js';
import {fromJsonSchema} from '../schema-engine/from-json-schema.js';
import type {
  CatalogSchema,
  CompileOptions,
  JsonSchema,
  JsonSchemaValidator,
} from '../schema-engine/types.js';

interface CatalogValidatorBinding {
  readonly validator: JsonSchemaValidator;
  /**
   * Whether the validator was given for the catalog (`CatalogOptions`,
   * `Catalog.fromJson`, a `MessageProcessor`) rather than borrowed from the
   * catalog's `fromJsonSchema` entries.
   */
  readonly explicit: boolean;
}

const catalogValidators = new WeakMap<object, CatalogValidatorBinding>();

/**
 * Sets the validator a catalog compiles its plain JSON Schemas with. A
 * validator given for the catalog (`explicit`) replaces one borrowed from its
 * entries; otherwise the first validator bound stays.
 *
 * @param catalog The catalog.
 * @param validator The validator, or `undefined` to leave the catalog as it is.
 * @param explicit Whether the validator was given for the catalog, rather
 *   than borrowed from its `fromJsonSchema` entries.
 */
export function bindCatalogValidator(
  catalog: object,
  validator: JsonSchemaValidator | undefined,
  explicit: boolean,
): void {
  if (!validator) return;
  const bound = catalogValidators.get(catalog);
  if (!bound || (explicit && !bound.explicit)) {
    catalogValidators.set(catalog, {validator, explicit});
  }
}

/** The validator a catalog compiles its plain JSON Schemas with, if it has one. */
export function catalogValidator(catalog: unknown): JsonSchemaValidator | undefined {
  return typeof catalog === 'object' && catalog !== null
    ? catalogValidators.get(catalog)?.validator
    : undefined;
}

/**
 * The validator given for a catalog (not one borrowed from its entries), if
 * any, for the catalogs derived from it.
 */
export function explicitCatalogValidator(catalog: unknown): JsonSchemaValidator | undefined {
  if (typeof catalog !== 'object' || catalog === null) return undefined;
  const bound = catalogValidators.get(catalog);
  return bound?.explicit ? bound.validator : undefined;
}

/** The JSON Schema of each schema made by {@link unboundJsonSchema}, and what it is. */
const unbound = new WeakMap<object, {readonly json: JsonSchema; readonly what: string}>();

/**
 * A `CatalogSchema` for a plain JSON Schema that has no validator yet. Its
 * `jsonSchema` is the schema, so discovery reads it as usual; it validates
 * once {@link bindUnboundSchema} has compiled it with a catalog's validator.
 * Validating it directly throws a `noValidatorError`.
 *
 * @param json The JSON Schema.
 * @param what What the schema is, for error messages (e.g. `Agent function 'pay'`).
 */
export function unboundJsonSchema<T = unknown>(
  json: Record<string, unknown>,
  what: string,
): CatalogSchema<T> {
  const schema: CatalogSchema<T> = {
    '~standard': {
      version: 1,
      vendor: 'a2ui',
      validate: (): StandardSchemaV1.Result<T> => {
        throw missingValidator(what);
      },
      jsonSchema: {input: () => json, output: () => json},
    },
  };
  unbound.set(schema, {json, what});
  return schema;
}

/** Whether `schema` came from {@link unboundJsonSchema}. */
export function isUnboundJsonSchema(schema: unknown): boolean {
  return typeof schema === 'object' && schema !== null && unbound.has(schema);
}

const bound = new WeakMap<object, WeakMap<object, WeakMap<object, CatalogSchema>>>();

/**
 * Compiles a schema from {@link unboundJsonSchema} with `validator`, once per
 * schema, validator and referenced documents. Any other schema, or any
 * schema when there is no validator, is returned as it is.
 *
 * @param schema The schema.
 * @param validator The validator to compile with, if there is one.
 * @param defs The documents the schema's references resolve in.
 * @throws {A2uiConfigurationError} If the validator can't compile the schema.
 */
export function bindUnboundSchema(
  schema: CatalogSchema,
  validator: JsonSchemaValidator | undefined,
  defs: NonNullable<CompileOptions['defs']>,
): CatalogSchema {
  const source = unbound.get(schema);
  // Without a validator the schema stays unbound, and throws if it validates.
  if (!source || !validator) return schema;
  let byValidator = bound.get(schema);
  if (!byValidator) bound.set(schema, (byValidator = new WeakMap()));
  let byDefs = byValidator.get(validator);
  if (!byDefs) byValidator.set(validator, (byDefs = new WeakMap()));
  let compiled = byDefs.get(defs);
  if (!compiled) {
    try {
      compiled = fromJsonSchema(source.json, validator, {defs: {...defs}});
    } catch (err: unknown) {
      throw new A2uiConfigurationError(
        `${source.what}: its JSON Schema could not be compiled: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    byDefs.set(defs, compiled);
  }
  return compiled;
}

function missingValidator(what: string): A2uiConfigurationError {
  return noValidatorError(
    `${what} has a plain JSON Schema, which compiles with its catalog's validator: register the catalog with a MessageProcessor, pass one in CatalogOptions.validator, or write the schema as fromJsonSchema(schema, validator).`,
  );
}
