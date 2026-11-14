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

// ponytail: bridge until Task 8 — zod catalog schemas are converted here so
// JSON Schema discovery can read them; delete this file with zod authoring.

import {z} from 'zod';
import {
  ignoreOverride,
  parseDef,
  parseObjectDef,
  zodToJsonSchema,
  type OverrideCallback,
} from 'zod-to-json-schema';

import {isAtLeastVersion} from '../common/semver.js';
import {exclusiveUnionOverride} from '../catalog/exclusive_union.js';
import {zodChildRefKindOf} from '../types/child-ref-helpers.js';
import V09CommonTypes from '../v0_9/schemas/common_types.json' with {type: 'json'};
import V091CommonTypes from '../v0_9_1/schemas/common_types.json' with {type: 'json'};
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import type {SchemaCursor} from './nav.js';
import type {JsonSchema} from './types.js';

const COMMON_TYPES = 'common_types.json';

/**
 * The common types document for a protocol version. v0.8 ships none; its
 * catalogs reference child ids structurally, so v0.9's stands in for the
 * `ComponentId`/`ChildList` targets a stamped schema is written as.
 */
function commonTypesFor(protocolVersion: string | undefined): JsonSchema {
  if (!protocolVersion || isAtLeastVersion(protocolVersion, '1.0')) {
    return V10CommonTypes as JsonSchema;
  }
  if (isAtLeastVersion(protocolVersion, '0.9.1')) return V091CommonTypes as JsonSchema;
  return V09CommonTypes as JsonSchema;
}

const withDescription = (json: Record<string, unknown>, def: z.ZodTypeDef) =>
  def.description === undefined ? json : {...json, description: def.description};

/**
 * Keeps what the Zod discovery walk read: a `markChildRef` stamp becomes a
 * `$ref` to the common `ComponentId`/`ChildList`, a strip-mode object omits
 * `additionalProperties` (only `.strict()` writes `false`), and intersections
 * keep their members' `additionalProperties: false`.
 */
const discoveryOverride: OverrideCallback = (def, refs, seen, forceResolution) => {
  const exclusive = exclusiveUnionOverride(def, refs, seen, forceResolution);
  if (exclusive !== ignoreOverride) return exclusive;

  const kind = zodChildRefKindOf({_def: def} as z.ZodTypeAny);
  if (kind) {
    const name = kind === 'child-list' ? 'ChildList' : 'ComponentId';
    return withDescription({$ref: `${COMMON_TYPES}#/$defs/${name}`}, def);
  }

  const typeName = (def as {typeName?: string}).typeName;
  if (typeName === 'ZodObject') {
    const objectDef = def as z.ZodObjectDef;
    if (objectDef.unknownKeys !== 'strip' || objectDef.catchall._def.typeName !== 'ZodNever') {
      return ignoreOverride;
    }
    const {additionalProperties: _strip, ...json} = parseObjectDef(objectDef, refs);
    return withDescription(json, def);
  }
  if (typeName === 'ZodIntersection') {
    const {left, right} = def as z.ZodIntersectionDef;
    const allOf = [left, right]
      .map((side, i) =>
        parseDef(side._def, {...refs, currentPath: [...refs.currentPath, 'allOf', `${i}`]}),
      )
      .filter(part => part !== undefined);
    return withDescription({allOf}, def);
  }
  return ignoreOverride;
};

const cache = new WeakMap<z.ZodTypeAny, Map<JsonSchema, SchemaCursor>>();

/**
 * Converts a Zod catalog schema to JSON Schema for discovery, with the
 * protocol version's `common_types.json` as the referenced document.
 * Results are cached per schema object and common types document.
 *
 * @param schema The Zod schema to convert.
 * @param protocolVersion The catalog's protocol version; defaults to v1.0.
 * @returns The converted root node and its document.
 */
export function toSchemaDoc(schema: z.ZodTypeAny, protocolVersion?: string): SchemaCursor {
  const commonTypes = commonTypesFor(protocolVersion);
  let byVersion = cache.get(schema);
  if (!byVersion) {
    byVersion = new Map();
    cache.set(schema, byVersion);
  }
  const cached = byVersion.get(commonTypes);
  if (cached) return cached;

  const {$schema: _schema, ...root} = zodToJsonSchema(schema, {
    override: discoveryOverride,
  }) as Record<string, unknown>;
  const cursor: SchemaCursor = {node: root, doc: {root, defs: {[COMMON_TYPES]: commonTypes}}};
  byVersion.set(commonTypes, cursor);
  return cursor;
}
