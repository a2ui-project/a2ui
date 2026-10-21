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

import {z} from 'zod';
import {ignoreOverride, parseDef, type OverrideCallback} from 'zod-to-json-schema';

/**
 * The definitions of the guards that make a union exclusive. A JSON Schema
 * `oneOf` loads as `guard.pipe(union)`; describing or defaulting the pipe
 * copies or wraps its definition but keeps the guard, so the guard marks it.
 */
const exclusiveGuards = new WeakSet<z.ZodTypeDef>();

/**
 * Returns a schema that accepts a value only when exactly one of `branches`
 * accepts it, the semantics of a JSON Schema `oneOf`. A plain `z.union` has
 * the semantics of `anyOf`.
 *
 * @param branches The union's branches, at least two.
 */
export function exclusiveUnion(
  branches: readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
): z.ZodTypeAny {
  const guard = z.any().superRefine((val, ctx) => {
    let matches = 0;
    for (const b of branches) {
      if (b.safeParse(val).success && ++matches > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Value matched more than one schema in oneOf',
        });
        return;
      }
    }
  });
  exclusiveGuards.add(guard._def);
  return guard.pipe(z.union(branches));
}

/**
 * A `zod-to-json-schema` override that writes a union made with
 * {@link exclusiveUnion} as `oneOf`, so that it keeps its semantics. Every
 * other schema, including a plain `z.union`, which `zod-to-json-schema`
 * writes as `anyOf`, is converted as usual.
 */
export const exclusiveUnionOverride: OverrideCallback = (def, refs) => {
  const pipe = def as Partial<z.ZodPipelineDef<z.ZodTypeAny, z.ZodTypeAny>>;
  if (!pipe.in || !pipe.out || !exclusiveGuards.has(pipe.in._def)) return ignoreOverride;
  const options = (pipe.out._def as z.ZodUnionDef).options;
  const oneOf = options
    .map((option, index) =>
      parseDef(option._def, {...refs, currentPath: [...refs.currentPath, 'oneOf', `${index}`]}),
    )
    .filter(branch => branch !== undefined);
  return def.description === undefined ? {oneOf} : {oneOf, description: def.description};
};
