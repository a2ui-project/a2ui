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

import type {CatalogSchema} from '@a2ui/web_core/schema-engine';
import * as z from 'zod';
import {ignoreOverride, zodToJsonSchema} from 'zod-to-json-schema';

/**
 * The definitions of the common types, with the name of their definition in
 * `common_types.json`.
 */
const commonTypes = new Map<z.ZodTypeDef, string>();

/**
 * Registers `schema` as the common type `name`, which {@link a2uiJsonSchema}
 * writes as `{$ref: 'common_types.json#/$defs/<name>'}`.
 *
 * @internal
 */
export function commonType<T extends z.ZodTypeAny>(name: string, schema: T): T {
  commonTypes.set(schema._def, name);
  return schema;
}

/**
 * The common type a definition is, or was copied from by `.describe()`
 * (which copies the definition and sets `description`), if any.
 */
function commonTypeOf(def: z.ZodTypeDef): string | undefined {
  const name = commonTypes.get(def);
  if (name || def.description === undefined) return name;
  const own = def as unknown as Record<string, unknown>;
  for (const [candidate, candidateName] of commonTypes) {
    const other = candidate as unknown as Record<string, unknown>;
    const keys = new Set([...Object.keys(own), ...Object.keys(other)]);
    keys.delete('description');
    if ([...keys].every(k => own[k] === other[k])) return candidateName;
  }
  return undefined;
}

/** The JSON Schema targets {@link a2uiJsonSchema} converts to. */
export type A2uiJsonSchemaTarget = 'draft-2020-12' | 'draft-07' | 'openapi-3.0';

const TARGETS: Record<
  A2uiJsonSchemaTarget,
  {target: 'jsonSchema2019-09' | 'jsonSchema7' | 'openApi3'; $schema?: string}
> = {
  // zod-to-json-schema has no 2020-12 target; its 2019-09 output is read as
  // 2020-12, which it matches except for tuples (`items` as an array).
  'draft-2020-12': {
    target: 'jsonSchema2019-09',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
  },
  'draft-07': {target: 'jsonSchema7', $schema: 'http://json-schema.org/draft-07/schema#'},
  'openapi-3.0': {target: 'openApi3'},
};

/**
 * Converts a zod 3 schema to JSON Schema with `zod-to-json-schema`, writing
 * each A2UI common type it uses as a `$ref` into the protocol's common types:
 * `{$ref: 'common_types.json#/$defs/<Name>'}`, with the `description` the use
 * adds. This is how web_core finds the bindings and child references of a
 * schema.
 *
 * Reused schemas are written out at each use rather than as `$ref`s to their
 * first use, so the result stays valid where a catalog places it. Objects
 * other than `.strict()` ones accept unknown properties, as zod 3 does when
 * it parses (it strips them).
 *
 * @throws {Error} For a target other than {@link A2uiJsonSchemaTarget}.
 */
export function a2uiJsonSchema(
  schema: z.ZodTypeAny,
  target: string = 'draft-2020-12',
): Record<string, unknown> {
  const t = TARGETS[target as A2uiJsonSchemaTarget];
  if (!t) throw new Error(`@a2ui/schema-zod3 cannot convert to JSON Schema target '${target}'.`);
  const json = zodToJsonSchema(schema, {
    target: t.target,
    $refStrategy: 'none',
    removeAdditionalStrategy: 'strict',
    override: def => {
      const name = commonTypeOf(def);
      if (!name) return ignoreOverride;
      const ref: Record<string, unknown> = {$ref: `common_types.json#/$defs/${name}`};
      if (def.description !== undefined) ref.description = def.description;
      return ref;
    },
  }) as Record<string, unknown>;
  delete json.$schema;
  return t.$schema ? {$schema: t.$schema, ...json} : json;
}

/**
 * Wraps a zod 3 schema (zod 3.24 or later) as a web_core `CatalogSchema`: it
 * validates with zod's `~standard.validate` and converts to JSON Schema with
 * {@link a2uiJsonSchema}.
 */
export function fromZod3<T extends z.ZodTypeAny>(
  schema: T,
): CatalogSchema<z.output<T>> & {readonly zod: T} {
  const standard = schema['~standard'];
  const convert = (opts: {readonly target: string}) => a2uiJsonSchema(schema, opts.target);
  return {
    zod: schema,
    '~standard': {
      version: 1,
      vendor: 'a2ui-zod3',
      validate: value =>
        standard.validate(value) as ReturnType<CatalogSchema<z.output<T>>['~standard']['validate']>,
      jsonSchema: {input: convert, output: convert},
    },
  };
}

/**
 * A component's schema: `z.object(shape)` as a web_core `CatalogSchema`
 * (see {@link fromZod3}). The shape holds the component's own properties,
 * not the envelope (`id`, `component`).
 */
export function component<Shape extends z.ZodRawShape>(
  shape: Shape,
): CatalogSchema<z.output<z.ZodObject<Shape>>> & {readonly zod: z.ZodObject<Shape>} {
  return fromZod3(z.object(shape));
}
