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

import {z} from 'zod';

const DYNAMIC_TYPE_REF =
  /^REF:[^|#]*#\/\$defs\/(DynamicString|DynamicNumber|DynamicBoolean|DynamicStringList|DynamicValue)(?:\||$)/;

const EXPECTED_DYNAMIC_RETURN_TYPES: Readonly<Record<string, string>> = {
  DynamicString: 'string',
  DynamicNumber: 'number',
  DynamicBoolean: 'boolean',
  DynamicStringList: 'array',
  DynamicValue: 'any',
};

function innerZodSchema(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
  const def = schema._def as {
    typeName?: string;
    innerType?: z.ZodTypeAny;
    schema?: z.ZodTypeAny;
    type?: z.ZodTypeAny;
    out?: z.ZodTypeAny;
    getter?: () => z.ZodTypeAny;
  };
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
      return def.innerType;
    case 'ZodBranded':
      return def.type;
    case 'ZodEffects':
      return def.schema;
    case 'ZodPipeline':
      return def.out;
    case 'ZodLazy':
      return def.getter?.();
    default:
      return undefined;
  }
}

function unwrapZodSchema(schema: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined {
  let current = schema;
  for (
    let next = current && innerZodSchema(current);
    next;
    next = current && innerZodSchema(current)
  ) {
    current = next;
  }
  return current;
}

function directDynamicReturnType(schema: z.ZodTypeAny | undefined): string | undefined {
  for (let current = schema; current; current = innerZodSchema(current)) {
    const desc = current.description;
    const match = typeof desc === 'string' ? DYNAMIC_TYPE_REF.exec(desc) : null;
    if (match) return EXPECTED_DYNAMIC_RETURN_TYPES[match[1]];
  }
  return undefined;
}

/**
 * Returns the set of allowed pre-1.0 `FunctionCall.returnType` values for a
 * typed `Dynamic*` Zod slot schema, or `undefined` if unconstrained.
 */
export function allowedReturnTypesForZodSchema(
  schema: z.ZodTypeAny | undefined,
): ReadonlySet<string> | undefined {
  const direct = directDynamicReturnType(schema);
  if (direct !== undefined) {
    return direct === 'any' ? undefined : new Set([direct]);
  }
  const core = unwrapZodSchema(schema);
  const def = core?._def as
    | {
        typeName?: string;
        options?: z.ZodTypeAny[];
        left?: z.ZodTypeAny;
        right?: z.ZodTypeAny;
      }
    | undefined;
  if (def?.typeName === 'ZodIntersection' && def.left && def.right) {
    return allowedReturnTypesForZodSchema(def.left) ?? allowedReturnTypesForZodSchema(def.right);
  }
  if (
    (def?.typeName === 'ZodUnion' || def?.typeName === 'ZodDiscriminatedUnion') &&
    Array.isArray(def.options)
  ) {
    return allowedReturnTypesForUnion(def.options);
  }
  return undefined;
}

function allowedReturnTypesForUnion(
  options: readonly z.ZodTypeAny[],
): ReadonlySet<string> | undefined {
  const types = new Set<string>();
  for (const opt of options) {
    if (directDynamicReturnType(opt) === 'any') return undefined;
    const branchTypes = allowedReturnTypesForZodSchema(opt);
    if (branchTypes) {
      for (const t of branchTypes) types.add(t);
    }
  }
  return types.size > 0 ? types : undefined;
}

function combineSchemas(schemas: readonly z.ZodTypeAny[]): z.ZodTypeAny | undefined {
  if (schemas.length === 0) return undefined;
  if (schemas.length === 1) return schemas[0];
  return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

/** Returns the item schema of a Zod array or union-of-arrays schema, if any. */
export function zodElementSchema(schema: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined {
  const core = unwrapZodSchema(schema);
  if (!core) return undefined;
  const def = core._def as {typeName?: string; type?: z.ZodTypeAny; options?: z.ZodTypeAny[]};
  if (def.typeName === 'ZodArray') {
    return def.type;
  }
  if (
    (def.typeName === 'ZodUnion' || def.typeName === 'ZodDiscriminatedUnion') &&
    Array.isArray(def.options) &&
    directDynamicReturnType(schema) === undefined
  ) {
    const matches = def.options
      .map(opt => zodElementSchema(opt))
      .filter((item): item is z.ZodTypeAny => item !== undefined);
    return combineSchemas(matches);
  }
  return undefined;
}

/** Returns the property schema for `key` on a Zod object/record/union schema, if any. */
export function zodPropertySchema(
  schema: z.ZodTypeAny | undefined,
  key: string,
  record?: Record<string, unknown>,
): z.ZodTypeAny | undefined {
  const core = unwrapZodSchema(schema);
  if (!core) return undefined;
  const def = core._def as {
    typeName?: string;
    shape?: () => Record<string, z.ZodTypeAny>;
    valueType?: z.ZodTypeAny;
    left?: z.ZodTypeAny;
    right?: z.ZodTypeAny;
    options?: z.ZodTypeAny[];
  };
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = def.shape?.();
      return shape && typeof shape === 'object' ? shape[key] : undefined;
    }
    case 'ZodRecord':
      return def.valueType;
    case 'ZodIntersection':
      return zodPropertySchema(def.right, key, record) ?? zodPropertySchema(def.left, key, record);
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return unionPropertySchema(schema, core, def.options, key, record);
    default:
      return undefined;
  }
}

function narrowUnionOptions(
  core: z.ZodTypeAny,
  options: readonly z.ZodTypeAny[],
  record?: Record<string, unknown>,
): readonly z.ZodTypeAny[] {
  if (!record) return options;
  const def = core._def as {
    typeName?: string;
    discriminator?: string;
    optionsMap?: Map<unknown, z.ZodTypeAny>;
  };
  if (
    def.typeName === 'ZodDiscriminatedUnion' &&
    typeof def.discriminator === 'string' &&
    def.optionsMap instanceof Map
  ) {
    const match = def.optionsMap.get(record[def.discriminator]);
    return match ? [match] : options;
  }
  const matching = options.filter(opt => opt.safeParse(record).success);
  return matching.length > 0 ? matching : options;
}

/** Narrows a Zod union schema to the branches matching `record`. */
export function zodNarrowRecordSchema(
  schema: z.ZodTypeAny | undefined,
  record: Record<string, unknown>,
): z.ZodTypeAny | undefined {
  const core = unwrapZodSchema(schema);
  if (!core || directDynamicReturnType(schema) !== undefined) {
    return schema;
  }
  const def = core._def as {
    typeName?: string;
    options?: z.ZodTypeAny[];
  };
  if (
    (def.typeName === 'ZodUnion' || def.typeName === 'ZodDiscriminatedUnion') &&
    Array.isArray(def.options)
  ) {
    return combineSchemas(narrowUnionOptions(core, def.options, record));
  }
  return core;
}

function unionPropertySchema(
  schema: z.ZodTypeAny | undefined,
  core: z.ZodTypeAny,
  options: readonly z.ZodTypeAny[] | undefined,
  key: string,
  record?: Record<string, unknown>,
): z.ZodTypeAny | undefined {
  if (!Array.isArray(options) || directDynamicReturnType(schema) !== undefined) {
    return undefined;
  }
  const active = narrowUnionOptions(core, options, record);
  const matches = active
    .map(opt => zodPropertySchema(opt, key, record))
    .filter((found): found is z.ZodTypeAny => found !== undefined);
  return combineSchemas(matches);
}
