/*
 * Copyright 2026 Google LLC
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
 * @fileoverview Zod 3 / Zod 4 JSON Schema conversion compatibility utilities.
 *
 * This module provides a custom `zodToJsonSchema` function that handles both
 * Zod 3 and 4.
 *
 * - For Zod 3, delegates conversion to the `zod-to-json-schema` library.
 * - For Zod 4, adapts Zod 4's native `z.toJSONSchema` and Registry API outputs to match
 *   the JSON Schema structure expected by the A2UI specification.
 */

import {z} from 'zod';
import zodToJsonSchemaLegacy from 'zod-to-json-schema';

/**
 * Detects whether the installed Zod library is version 4.
 *
 * In Zod 3, schemas store their type identifier on `_def.typeName` (e.g. 'ZodString').
 * In Zod 4, `_def.typeName` was removed and internal state is stored on `_zod`.
 */
function isZod4(): boolean {
  return !('_def' in z.string() && 'typeName' in (z.string() as any)._def);
}

/**
 * Generates JSON Schema using the `zod-to-json-schema` library.
 */
function zod3ToJsonSchema(schema: any, options?: any): Record<string, any> {
  return zodToJsonSchemaLegacy(schema, options) as Record<string, any>;
}

/**
 * Recursively processes the schema node to inline generated anonymous references (`schema0`, `__shared`).
 *
 * Zod 4's native schema generator emits synthetic references for anonymous recursive/shared nodes
 * which need to be flattened to match standard JSON Schema expectations.
 */
function inlineGeneratedRefs(node: any, defsPool: Record<string, any>, depth = 0): any {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.map(item => inlineGeneratedRefs(item, defsPool, depth));
  }
  if (node.$ref && typeof node.$ref === 'string') {
    const refStr = node.$ref;
    if (refStr.includes('schema0') || refStr.includes('__shared') || refStr.includes('__schema')) {
      const lastSegment = refStr.split('/').pop() || '';
      const targetKey = Object.keys(defsPool).find(
        k => refStr.endsWith(k) || k === lastSegment || refStr.endsWith(`/${k}`),
      );
      const target = targetKey ? defsPool[targetKey] : undefined;
      if (target) {
        if (depth >= 1) {
          const {valueMap: _, ...restProps} = target.properties || {};
          return {...target, properties: restProps};
        }
        return inlineGeneratedRefs(target, defsPool, depth + 1);
      }
    }
  }
  const copy: Record<string, any> = {};
  for (const [k, v] of Object.entries(node)) {
    copy[k] = inlineGeneratedRefs(v, defsPool, depth);
  }
  return copy;
}

/**
 * Generates JSON Schema using Zod 4's native `toJSONSchema` method and Registry API.
 */
function zod4ToJsonSchema(schema: any, options?: any): Record<string, any> {
  // A2UI strictly uses Draft 2020-12 (and Draft 2019-09), so this segment is always set to '$defs'.
  // Note: Older JSON Schema drafts (such as Draft 7 and earlier) use 'definitions'.
  const defsSegment = '$defs';
  const definitionsMap = options?.$defs || options?.definitions;
  const hasDefs = definitionsMap && Object.keys(definitionsMap).length > 0;
  const hasName = Boolean(options?.name);
  // Call things on z as if it was zod 4.
  const zod4 = z as any;

  // When external sub-definitions or a root schema name wrapper are provided (e.g. protocol message
  // envelope schemas), register them in Zod 4's Registry and output a $defs container.
  if (hasDefs || hasName) {
    // Use a Zod 4 Registry with explicit IDs to resolve $ref pointers.
    const reg = zod4.registry();
    if (hasDefs) {
      for (const [id, defSchema] of Object.entries(definitionsMap)) {
        reg.add(defSchema, {id});
      }
    }
    if (hasName) {
      reg.add(schema, {id: options.name});
    }

    // Generate raw JSON Schema from the Registry using standard fragment URIs (#/$defs/ID).
    const res = zod4.toJSONSchema(reg, {
      ...options,
      uri: (id: string) => `#/${defsSegment}/${id}`,
    });

    // Build a pool of all schemas (including Zod 4's internal '__shared' bucket) to resolve
    // unregistered anonymous recursive references (such as DataEntrySchema in v0.8 dataModelUpdate).
    const schemas = res.schemas || {};
    const sharedBucket = schemas.__shared || {};
    const sharedDefs = sharedBucket.$defs || sharedBucket.definitions || sharedBucket;
    const allSchemas = {
      ...schemas,
      ...sharedDefs,
    };
    const defs: Record<string, any> = {};

    // Resolve anonymous references across all schemas (used on v0.8).
    for (const [id, sch] of Object.entries(schemas)) {
      // Do not emit zod4's internal `__shared` schemas.
      if (id !== '__shared') {
        defs[id] = inlineGeneratedRefs(sch, allSchemas);
      }
    }

    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      [defsSegment]: defs,
    };
  }

  // Fall-through path: executed for standalone schemas without sub-definitions or name wrappers
  // (e.g. individual catalog component APIs or theme schemas in MessageProcessor).
  const rawRoot = zod4.toJSONSchema(schema, options) as Record<string, any>;
  const rawDefs = rawRoot.$defs || rawRoot.definitions || {};
  const defsPool = {
    ...rawDefs,
    ...(rawDefs.__shared?.$defs || rawDefs.__shared?.definitions || rawDefs.__shared || {}),
  };
  return inlineGeneratedRefs(rawRoot, defsPool);
}

/**
 * Unwraps Zod effect and pipeline wrappers (such as `.superRefine(...)` or `.pipe(...)`)
 * to expose the underlying structural object schema for JSON Schema generation.
 *
 * In Zod 3, refinements create `ZodEffects` (`_def.schema`), whereas in Zod 4 they create
 * `ZodPipe` (`_def.in`).
 */
export function unwrapForJsonSchema(schema: any): any {
  let current = schema;
  while (current && current._def) {
    const name = current.constructor?.name;
    const typeName = current._def.typeName;
    if (
      name === 'ZodEffects' ||
      name === 'ZodPipe' ||
      name === 'ZodRefine' ||
      name === 'ZodSuperRefine' ||
      typeName === 'ZodEffects'
    ) {
      const next = current._def.schema || current._def.in;
      if (!next || next === current) break;
      current = next;
    } else {
      break;
    }
  }
  return current;
}

/**
 * JSON Schema generator for Zod 3 and Zod 4.
 *
 * In Zod 4, utilizes the native `z.toJSONSchema` static method and Registry API.
 * In Zod 3, falls back to the `zod-to-json-schema` library.
 */
export function zodToJsonSchema(schema: any, options?: any): Record<string, any> {
  const unwrapped = unwrapForJsonSchema(schema);
  if (isZod4()) {
    return zod4ToJsonSchema(unwrapped, options);
  }
  return zod3ToJsonSchema(unwrapped, options);
}

/**
 * Extracts the shape from a ZodObject schema, handling potential issues
 * with minification (e.g. Closure Compiler) or internal property differences
 * between Zod versions.
 */
export function getObjectShape<T extends z.ZodRawShape>(schema: z.ZodObject<T, any>): T;
export function getObjectShape(schema: any): Record<string, any> | undefined;
export function getObjectShape(schema: any): any {
  if (!schema) return undefined;
  const shape = schema.shape ?? schema._zod?.def?.shape ?? schema._def?.shape;
  return typeof shape === 'function' ? shape() : shape;
}
