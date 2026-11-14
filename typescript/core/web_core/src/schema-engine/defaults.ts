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

import {
  arrayItems,
  deref,
  objectProperties,
  unwrapField,
  type SchemaCursor,
  type SchemaDoc,
} from './nav.js';
import type {JsonSchema} from './types.js';

type Obj = {[k: string]: unknown};

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A copy of a JSON default, so the value never shares an object with the schema. */
const copyDefault = (v: unknown): unknown =>
  typeof v === 'object' && v !== null ? structuredClone(v) : v;

/**
 * The single `oneOf` branch whose `const` properties all equal the value's,
 * or `undefined` when none or several match. A branch without a `const`
 * property never matches: no validator runs here.
 */
function matchingBranch(value: Obj, node: JsonSchema, doc: SchemaDoc): SchemaCursor | undefined {
  const c = deref(node, doc);
  if (!isObj(c.node) || !Array.isArray(c.node['oneOf'])) return undefined;
  const matches: SchemaCursor[] = [];
  for (const option of c.node['oneOf'] as JsonSchema[]) {
    const shape = objectProperties(option, c.doc);
    if (!shape) continue;
    let discriminated = false;
    let matched = true;
    for (const [key, prop] of Object.entries(shape.properties)) {
      const target = deref(prop.node, prop.doc).node;
      if (!isObj(target) || !('const' in target)) continue;
      discriminated = true;
      if (JSON.stringify(value[key]) !== JSON.stringify(target['const'])) matched = false;
    }
    if (discriminated && matched) matches.push({node: option, doc: c.doc});
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function applyObject(value: Obj, node: JsonSchema, doc: SchemaDoc): Obj {
  let result = value;
  const set = (key: string, v: unknown) => {
    if (result === value) result = {...value};
    result[key] = v;
  };
  const shape = objectProperties(node, doc);
  if (shape) {
    for (const [key, prop] of Object.entries(shape.properties)) {
      if (Object.hasOwn(value, key) && value[key] !== undefined) {
        const next = applyDefaults(value[key], prop.node, prop.doc);
        if (next !== value[key]) set(key, next);
      } else if (!shape.required.has(key)) {
        const field = unwrapField(prop.node, prop.doc, false);
        if (field.default !== undefined) set(key, copyDefault(field.default));
      }
    }
  }
  const branch = matchingBranch(value, node, doc);
  return branch ? applyObject(result, branch.node, branch.doc) : result;
}

/**
 * Returns `value` with the JSON Schema `default`s of its missing optional
 * object properties filled in.
 *
 * Recurses into `properties` (merged across `allOf`), array `items`, and
 * the one `oneOf` branch whose `const` properties match the value. The input
 * is never mutated: changed objects and arrays are shallow copies, and
 * everything unchanged is shared with the input. A value with nothing to
 * fill is returned as is.
 *
 * @param value The value to fill.
 * @param node The schema of `value`.
 * @param doc The document that owns `node`.
 * @returns `value`, or a copy of it with the defaults filled in.
 */
export function applyDefaults(value: unknown, node: JsonSchema, doc: SchemaDoc): unknown {
  if (Array.isArray(value)) {
    const items = arrayItems(node, doc);
    if (!items) return value;
    let changed = false;
    const next = value.map(item => {
      const filled = applyDefaults(item, items.node, items.doc);
      changed ||= filled !== item;
      return filled;
    });
    return changed ? next : value;
  }
  return isObj(value) ? applyObject(value, node, doc) : value;
}
