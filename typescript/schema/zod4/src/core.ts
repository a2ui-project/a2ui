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
import {z} from 'zod';

/** The common types, by the name of their definition in `common_types.json`. */
const commonTypes = z.registry<{a2uiCommonType: string}>();

/** The annotations an author's use of a common type keeps beside its `$ref`. */
const ANNOTATIONS = [
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
] as const;

/**
 * Registers `schema` as the common type `name`, which {@link a2uiJsonSchema}
 * writes as `{$ref: 'common_types.json#/$defs/<name>'}`.
 *
 * @internal
 */
export function commonType<T extends z.ZodType>(name: string, schema: T): T {
  commonTypes.add(schema, {a2uiCommonType: name});
  return schema;
}

/**
 * The common type `schema` is, or was derived from by `.describe()` or
 * `.meta()`, if any.
 */
function commonTypeOf(schema: z.core.$ZodType): string | undefined {
  for (let s: z.core.$ZodType | undefined = schema; s; s = s._zod.parent) {
    const name = commonTypes.get(s)?.a2uiCommonType;
    if (name) return name;
  }
  return undefined;
}

/** Options of {@link a2uiJsonSchema}: those of zod's `z.toJSONSchema`. */
export type A2uiJsonSchemaOptions = NonNullable<Parameters<typeof z.toJSONSchema>[1]>;

/**
 * Converts a zod 4 schema to JSON Schema (draft 2020-12, input types by
 * default) with `z.toJSONSchema`, writing each A2UI common type it uses as a
 * `$ref` into the protocol's common types:
 * `{$ref: 'common_types.json#/$defs/<Name>'}`, with the annotations
 * (`description`, `default`, ...) the use adds. This is how web_core finds
 * the bindings and child references of a schema.
 *
 * An `override` in `options` runs after the common types are written.
 */
export function a2uiJsonSchema(
  schema: z.ZodType,
  options: A2uiJsonSchemaOptions = {},
): Record<string, unknown> {
  const {override, ...rest} = options;
  return z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    ...rest,
    override: ctx => {
      const name = commonTypeOf(ctx.zodSchema);
      if (name) {
        const json = ctx.jsonSchema as Record<string, unknown>;
        const kept: Record<string, unknown> = {};
        for (const key of ANNOTATIONS) if (key in json) kept[key] = json[key];
        for (const key of Object.keys(json)) delete json[key];
        Object.assign(json, {$ref: `common_types.json#/$defs/${name}`}, kept);
      }
      override?.(ctx);
    },
  }) as Record<string, unknown>;
}

/**
 * Wraps a zod 4 schema as a web_core `CatalogSchema`: it validates with
 * zod's `~standard.validate` and converts to JSON Schema with
 * {@link a2uiJsonSchema}.
 */
export function catalogSchema<T extends z.ZodType>(
  schema: T,
): CatalogSchema<z.output<T>> & {readonly zod: T} {
  const standard = schema['~standard'];
  const convert =
    (io: 'input' | 'output') =>
    (opts: {readonly target: string; readonly libraryOptions?: Record<string, unknown>}) =>
      a2uiJsonSchema(schema, {
        ...(opts.libraryOptions as A2uiJsonSchemaOptions | undefined),
        target: opts.target as A2uiJsonSchemaOptions['target'],
        io,
      });
  return {
    zod: schema,
    '~standard': {
      version: 1,
      vendor: 'a2ui-zod4',
      validate: value =>
        standard.validate(value) as ReturnType<CatalogSchema<z.output<T>>['~standard']['validate']>,
      jsonSchema: {input: convert('input'), output: convert('output')},
    },
  };
}

/**
 * A component's schema: `z.object(shape)` as a web_core `CatalogSchema`
 * (see {@link catalogSchema}). The shape holds the component's own
 * properties, not the envelope (`id`, `component`).
 */
export function component<Shape extends z.ZodRawShape>(
  shape: Shape,
): CatalogSchema<z.output<z.ZodObject<Shape>>> & {readonly zod: z.ZodObject<Shape>} {
  return catalogSchema(z.object(shape));
}
