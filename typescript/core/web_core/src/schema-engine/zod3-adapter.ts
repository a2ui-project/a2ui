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

// ponytail: removed with the zod mirrors in Task 11 — the one place zod 3
// catalog schemas become CatalogSchemas, for the still-zod basic catalogs,
// loader-derived schemas and test fixtures.

import {z} from 'zod';
import {ignoreOverride, parseDef, zodToJsonSchema, type OverrideCallback} from 'zod-to-json-schema';

import type {StandardSchemaV1} from '@standard-schema/spec';

import {exclusiveUnionOverride} from '../catalog/exclusive_union.js';
import {zodChildRefKindOf} from '../types/child-ref-helpers.js';
import type {CatalogSchema, JsonSchema} from './types.js';

const COMMON_TYPES = 'common_types.json';

const withDescription = (json: Record<string, unknown>, def: z.ZodTypeDef) =>
  def.description === undefined ? json : {...json, description: def.description};

/** Zod wrappers whose own description hides the wrapped schema's. */
const WRAPPED_KEY: Readonly<Record<string, string>> = {
  ZodOptional: 'innerType',
  ZodNullable: 'innerType',
  ZodDefault: 'innerType',
  ZodCatch: 'innerType',
  ZodReadonly: 'innerType',
  ZodBranded: 'type',
  ZodEffects: 'schema',
};

/** The `REF:<ref>` marker of the first wrapped schema below `def` that carries one. */
function wrappedRef(def: z.ZodTypeDef): string | undefined {
  for (let d: z.ZodTypeDef | undefined = def; d; ) {
    const key: string | undefined = WRAPPED_KEY[(d as {typeName?: string}).typeName ?? ''];
    const inner: z.ZodTypeDef | undefined = key
      ? (d as unknown as Record<string, z.ZodTypeAny | undefined>)[key]?._def
      : undefined;
    const description = inner?.description;
    if (typeof description === 'string' && description.startsWith('REF:')) {
      return description.split('|')[0];
    }
    d = inner;
  }
  return undefined;
}

/** Whether a schema is a zod object that strips or rejects unknown keys. */
function objectMode(schema: z.ZodTypeAny): 'strip' | 'strict' | undefined {
  const def = schema._def as Partial<z.ZodObjectDef> & {typeName?: string};
  if (def.typeName !== 'ZodObject' || def.catchall?._def.typeName !== 'ZodNever') {
    return undefined;
  }
  return def.unknownKeys === 'strip' || def.unknownKeys === 'strict' ? def.unknownKeys : undefined;
}

/**
 * Writes what discovery reads: a `markChildRef` stamp becomes a `$ref` to the
 * common `ComponentId`/`ChildList`, a re-described wrapper keeps its `REF:`
 * marker, and intersections are written as zod reads them. Objects are
 * written as zod-to-json-schema writes them: strip and strict objects are
 * closed (`additionalProperties: false`), so an absent `additionalProperties`
 * always means open.
 */
const discoveryOverride: OverrideCallback = (def, refs, seen, forceResolution) => {
  const exclusive = exclusiveUnionOverride(def, refs, seen, forceResolution);
  if (exclusive !== ignoreOverride) return exclusive;

  // A wrapper's own description replaces the wrapped schema's `REF:` marker;
  // keep the marker in front of it, as `REF:<ref>|<description>`.
  if (typeof def.description === 'string' && !def.description.startsWith('REF:')) {
    const ref = wrappedRef(def);
    if (ref !== undefined) {
      const json = parseDef({...def, description: undefined}, refs) as Record<string, unknown>;
      return {...json, description: `${ref}|${def.description}`};
    }
  }

  const kind = zodChildRefKindOf({_def: def} as z.ZodTypeAny);
  if (kind) {
    const name = kind === 'child-list' ? 'ChildList' : 'ComponentId';
    return withDescription({$ref: `${COMMON_TYPES}#/$defs/${name}`}, def);
  }

  const typeName = (def as {typeName?: string}).typeName;
  if (typeName === 'ZodIntersection') {
    // zod intersects strip objects by merging what each side keeps, so a
    // strip member is open to the other member's keys; the intersection of
    // two strip or strict objects drops any other key, like
    // `unevaluatedProperties: false`.
    const {left, right} = def as z.ZodIntersectionDef;
    const allOf = [left, right]
      .map((side, i) => {
        const part = parseDef(side._def, {
          ...refs,
          currentPath: [...refs.currentPath, 'allOf', `${i}`],
        }) as Record<string, unknown> | undefined;
        if (part && objectMode(side) === 'strip') {
          const {additionalProperties: _open, ...rest} = part;
          return rest;
        }
        return part;
      })
      .filter(part => part !== undefined);
    const closed = [left, right].every(side => objectMode(side) !== undefined);
    return withDescription(closed ? {allOf, unevaluatedProperties: false} : {allOf}, def);
  }
  return ignoreOverride;
};

/** Whether `value` is a zod 3 schema. */
export function isZod3Schema(value: unknown): value is z.ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_def' in value &&
    typeof (value as {safeParse?: unknown}).safeParse === 'function' &&
    (value as {'~standard'?: {vendor?: unknown}})['~standard']?.vendor === 'zod'
  );
}

/** The issues this adapter's `validate` returned, which are zod issues. */
const zodIssues = new WeakSet<object>();

/**
 * The zod issues behind Standard issues from {@link fromZod3}, or
 * `undefined` if any issue came from another schema. Lets callers keep zod's
 * wording for zod catalogs until they are removed.
 */
export function zod3Issues(issues: readonly StandardSchemaV1.Issue[]): z.ZodIssue[] | undefined {
  return issues.length > 0 && issues.every(i => zodIssues.has(i))
    ? (issues as z.ZodIssue[])
    : undefined;
}

const adapted = new WeakMap<z.ZodTypeAny, CatalogSchema>();

/**
 * Wraps a zod 3 schema into a {@link CatalogSchema}: `validate` is zod's own
 * `~standard.validate`, and `jsonSchema.input` the schema converted to JSON
 * Schema, with `markChildRef` stamps written as `$ref`s to
 * `common_types.json`. One wrapper per schema; the JSON is converted once.
 * The JSON does not depend on the protocol version: the version's common
 * types document is supplied where the schema is registered.
 *
 * @param schema The zod 3 schema.
 * @returns The schema as a `CatalogSchema`.
 */
export function fromZod3<T = unknown>(schema: z.ZodTypeAny): CatalogSchema<T> {
  const existing = adapted.get(schema);
  if (existing) return existing as CatalogSchema<T>;
  let json: Record<string, unknown> | undefined;
  const toJson = () => {
    if (!json) {
      const {$schema: _schema, ...root} = zodToJsonSchema(schema, {
        override: discoveryOverride,
      }) as Record<string, unknown>;
      json = root;
    }
    return json;
  };
  const wrapped: CatalogSchema<T> = {
    '~standard': {
      version: 1,
      vendor: 'a2ui-zod3',
      validate: value => {
        const r = schema['~standard'].validate(value) as
          | StandardSchemaV1.Result<T>
          | Promise<StandardSchemaV1.Result<T>>;
        if (r instanceof Promise) return r;
        for (const issue of r.issues ?? []) zodIssues.add(issue);
        return r;
      },
      jsonSchema: {input: toJson, output: toJson},
    },
  };
  adapted.set(schema, wrapped);
  return wrapped;
}

/** The zod→JSON conversion {@link fromZod3} uses, for tests. */
export function zod3ToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return fromZod3(schema)['~standard'].jsonSchema.input({target: 'draft-2020-12'});
}
