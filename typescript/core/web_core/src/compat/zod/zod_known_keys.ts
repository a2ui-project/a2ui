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

const schemaKeysCache = new WeakMap<z.ZodTypeAny, Set<string> | null>();

/**
 * Extracts declared property keys from a legacy Zod schema representing an
 * object with fixed keys, or returns `null` when arbitrary keys are permitted.
 */
export function getKnownZodSchemaKeys(schema: z.ZodTypeAny): Set<string> | null {
  if (!schema || typeof schema !== 'object') {
    return null;
  }
  if (schemaKeysCache.has(schema)) {
    return schemaKeysCache.get(schema) as Set<string> | null;
  }

  const result = ((): Set<string> | null => {
    let current: z.ZodTypeAny | undefined = schema;
    while (current) {
      const def = current._def as Record<string, unknown> | undefined;
      const typeName = def?.['typeName'];
      if (current instanceof z.ZodObject || typeName === 'ZodObject') {
        if (def?.['unknownKeys'] === 'passthrough') {
          return null;
        }
        const shapeProp = (current as {shape?: unknown}).shape;
        const shape = typeof shapeProp === 'function' ? shapeProp() : shapeProp;
        if (shape && typeof shape === 'object') {
          return new Set(Object.keys(shape));
        }
        return null;
      }
      if (current instanceof z.ZodEffects || typeName === 'ZodEffects') {
        current = def?.['schema'] as z.ZodTypeAny | undefined;
        continue;
      }
      if (
        current instanceof z.ZodOptional ||
        current instanceof z.ZodNullable ||
        current instanceof z.ZodDefault ||
        current instanceof z.ZodCatch ||
        typeName === 'ZodOptional' ||
        typeName === 'ZodNullable' ||
        typeName === 'ZodDefault' ||
        typeName === 'ZodCatch'
      ) {
        current = def?.['innerType'] as z.ZodTypeAny | undefined;
        continue;
      }
      if (current instanceof z.ZodIntersection || typeName === 'ZodIntersection') {
        const leftKeys = getKnownZodSchemaKeys(def?.['left'] as z.ZodTypeAny);
        const rightKeys = getKnownZodSchemaKeys(def?.['right'] as z.ZodTypeAny);
        if (!leftKeys || !rightKeys) {
          return null;
        }
        return new Set([...leftKeys, ...rightKeys]);
      }
      if (
        current instanceof z.ZodUnion ||
        current instanceof z.ZodDiscriminatedUnion ||
        typeName === 'ZodUnion' ||
        typeName === 'ZodDiscriminatedUnion'
      ) {
        const options = def?.['options'] as Iterable<z.ZodTypeAny> | undefined;
        if (!options) return null;
        const allKeys = new Set<string>();
        for (const opt of options) {
          const k = getKnownZodSchemaKeys(opt);
          if (!k) return null;
          for (const key of k) {
            allKeys.add(key);
          }
        }
        return allKeys;
      }
      return null;
    }
    return null;
  })();

  schemaKeysCache.set(schema, result);
  return result;
}
