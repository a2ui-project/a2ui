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

// Zod introspection the generic binder walks until it is ported to JSON Schema
// (Task 6); child-reference discovery itself reads JSON Schema (ref-fields.ts).

import {z} from 'zod';

import {type ChildRefKind, zodChildRefKindOf} from '../types/child-ref-helpers.js';
import {extractRefDefName} from './ref-fields.js';

/**
 * Unwrapped Zod schema and metadata collected across single-inner-type wrappers
 * (`optional`, `nullable`, `default`, `readonly`, `catch`, `effects`, `brand`, `lazy`).
 */
export interface UnwrappedZodField {
  readonly schema: z.ZodTypeAny;
  readonly descriptions: string[];
  readonly firstRefDefName: string;
  readonly refDefNames: Set<string>;
  readonly bareDefNames: Set<string>;
  readonly refs: Set<ChildRefKind>;
  readonly traversed: Set<z.ZodTypeAny>;
  readonly hasTransform: boolean;
}

function isCombinatorInheritedDescription(schema: z.ZodTypeAny, desc: string): boolean {
  const typeName = schema?._def?.typeName as string | undefined;
  if (typeName === 'ZodUnion') {
    const first = getUnionOptions(schema)?.[0];
    return Boolean(
      first &&
      (first.description === desc ||
        (first._def as {description?: string} | undefined)?.description === desc),
    );
  }
  if (typeName === 'ZodIntersection') {
    const left = (schema._def as {left?: z.ZodTypeAny}).left;
    return Boolean(
      left &&
      (left.description === desc ||
        (left._def as {description?: string} | undefined)?.description === desc),
    );
  }
  return false;
}

/**
 * Unwraps optional/nullable/default/readonly/catch/effects/branded/lazy wrappers,
 * collecting descriptions, `REF:` definition names, and child-ref markers along
 * the chain while stopping at combinators (`ZodPipeline`, `ZodIntersection`,
 * `ZodUnion`, `ZodDiscriminatedUnion`) and structural types.
 */
export function unwrapZodField(schema: z.ZodTypeAny): UnwrappedZodField {
  const descriptions: string[] = [];
  const refDefNames = new Set<string>();
  const bareDefNames = new Set<string>();
  const refs = new Set<ChildRefKind>();
  const traversed = new Set<z.ZodTypeAny>();
  const visitedGetters = new Set<() => z.ZodTypeAny>();
  let firstRefDefName = '';
  let hasTransform = false;
  let current = schema;

  while (current && typeof current === 'object' && current._def) {
    if (traversed.has(current)) {
      break;
    }
    traversed.add(current);

    if (current.description && !isCombinatorInheritedDescription(current, current.description)) {
      descriptions.push(current.description);
      const parsedRef = collectRefDefName(current.description, refDefNames, bareDefNames);
      if (!firstRefDefName && parsedRef) {
        firstRefDefName = parsedRef;
      }
    }
    const defDescription = (current._def as {description?: string}).description;
    if (
      defDescription &&
      defDescription !== current.description &&
      !isCombinatorInheritedDescription(current, defDescription)
    ) {
      descriptions.push(defDescription);
      const parsedRef = collectRefDefName(defDescription, refDefNames, bareDefNames);
      if (!firstRefDefName && parsedRef) {
        firstRefDefName = parsedRef;
      }
    }

    const ref = zodChildRefKindOf(current);
    if (ref) {
      refs.add(ref);
    }

    const typeName = current._def.typeName as string;
    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodDefault' ||
      typeName === 'ZodReadonly' ||
      typeName === 'ZodCatch'
    ) {
      current = current._def.innerType as z.ZodTypeAny;
    } else if (typeName === 'ZodEffects') {
      const effectDef = (current._def as {effect?: {type?: string}}).effect;
      if (effectDef?.type === 'transform' || effectDef?.type === 'preprocess') {
        hasTransform = true;
      }
      current = current._def.schema as z.ZodTypeAny;
    } else if (typeName === 'ZodBranded') {
      current = current._def.type as z.ZodTypeAny;
    } else if (typeName === 'ZodLazy') {
      const getter = current._def.getter as () => z.ZodTypeAny;
      if (visitedGetters.has(getter)) {
        break;
      }
      visitedGetters.add(getter);
      current = getter();
    } else {
      break;
    }
  }

  return {
    schema: current,
    descriptions,
    firstRefDefName,
    refDefNames,
    bareDefNames,
    refs,
    traversed,
    hasTransform,
  };
}

/**
 * Returns the option schemas of a `ZodUnion` or `ZodDiscriminatedUnion`, or
 * `undefined` if `schema` is neither.
 */
export function getUnionOptions(schema: z.ZodTypeAny): z.ZodTypeAny[] | undefined {
  const typeName = schema?._def?.typeName as string | undefined;
  if (typeName !== 'ZodUnion' && typeName !== 'ZodDiscriminatedUnion') {
    return undefined;
  }
  const rawOptions = (schema._def as {options?: z.ZodTypeAny[] | Map<unknown, z.ZodTypeAny>})
    .options;
  if (!rawOptions) {
    return undefined;
  }
  return Array.isArray(rawOptions) ? rawOptions : Array.from(rawOptions.values());
}

/**
 * Returns whether an unwrapped `ZodObject` matches a dynamic child-list template
 * shape (`{ componentId, path | @path | dataBinding }` or v0.8 `explicitList`/`template`).
 */
export function isZodTemplateRefObject(schema: z.ZodTypeAny): boolean {
  if (schema?._def?.typeName !== 'ZodObject') {
    return false;
  }
  const shape = (schema as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
  return Boolean(
    (Object.hasOwn(shape, 'componentId') &&
      (Object.hasOwn(shape, 'path') ||
        Object.hasOwn(shape, '@path') ||
        Object.hasOwn(shape, 'dataBinding'))) ||
    Object.hasOwn(shape, 'explicitList') ||
    Object.hasOwn(shape, 'template'),
  );
}

function collectRefDefName(
  description: string | undefined,
  refDefNames: Set<string>,
  bareDefNames: Set<string>,
): string {
  if (!description) {
    return '';
  }
  if (description.startsWith('REF:')) {
    const defName = extractRefDefName(description.slice(4).split('|')[0]);
    if (defName) {
      refDefNames.add(defName);
    }
    return defName;
  }
  const refTarget = extractRefDefName(description.split('|')[0]);
  if (refTarget) {
    bareDefNames.add(refTarget);
  }
  const trimmed = description.trim();
  if (trimmed) {
    bareDefNames.add(trimmed);
  }
  return '';
}
