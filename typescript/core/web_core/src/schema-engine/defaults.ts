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

/** Whether two JSON values are equal, with object keys in any order. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => jsonEqual(item, b[i]))
    );
  }
  if (!isObj(a) || !isObj(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(key => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
  );
}

/**
 * The `oneOf` lists of a schema and of its `allOf` members, each with the
 * document that owns it, following `$ref`s and nullable wrappers.
 */
function oneOfLists(
  node: JsonSchema,
  doc: SchemaDoc,
  found: SchemaCursor[][] = [],
  depth = 0,
): SchemaCursor[][] {
  if (depth > 32) return found;
  const c = unwrapField(node, doc, true);
  if (!isObj(c.node)) return found;
  if (Array.isArray(c.node['oneOf'])) {
    found.push((c.node['oneOf'] as JsonSchema[]).map(option => ({node: option, doc: c.doc})));
  }
  if (Array.isArray(c.node['allOf'])) {
    for (const member of c.node['allOf'] as JsonSchema[]) {
      oneOfLists(member, c.doc, found, depth + 1);
    }
  }
  return found;
}

/**
 * Whether a `oneOf` branch is the one a value takes: it declares at least one
 * `const` property, and the value's properties equal every one of them. No
 * validator runs here.
 */
function discriminates(value: Obj, option: SchemaCursor): boolean {
  const shape = objectProperties(option.node, option.doc);
  if (!shape) return false;
  let discriminated = false;
  for (const [key, prop] of Object.entries(shape.properties)) {
    const target = unwrapField(prop.node, prop.doc, true).node;
    if (!isObj(target) || !('const' in target)) continue;
    discriminated = true;
    if (!jsonEqual(value[key], target['const'])) return false;
  }
  return discriminated;
}

/**
 * The branches a value takes: for each `oneOf` of the schema and its `allOf`
 * members, the single branch that {@link discriminates} it, if exactly one
 * does.
 */
function matchingBranches(value: Obj, node: JsonSchema, doc: SchemaDoc): SchemaCursor[] {
  const branches: SchemaCursor[] = [];
  for (const options of oneOfLists(node, doc)) {
    const matches = options.filter(option => discriminates(value, option));
    if (matches.length === 1) branches.push(matches[0]);
  }
  return branches;
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
        // A default is itself filled, as a library schema parses the default
        // it applies.
        if (field.default !== undefined) {
          set(key, applyDefaults(copyDefault(field.default), prop.node, prop.doc));
        }
      }
    }
  }
  for (const branch of matchingBranches(value, node, doc)) {
    result = applyObject(result, branch.node, branch.doc);
  }
  return result;
}

/**
 * Returns `value` with the JSON Schema `default`s of its missing optional
 * object properties filled in, and the defaults inside those defaults.
 *
 * Recurses into `properties` (merged across `allOf`, through `$ref`s and
 * nullable wrappers), array `items`, and, for each `oneOf` of the schema or
 * of its `allOf` members, the one branch whose `const` properties match the
 * value. The input
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
  if (typeof value !== 'object' || value === null) return value;
  // A nullable schema (`anyOf: [schema, {type: 'null'}]`) fills as its schema.
  ({node, doc} = unwrapField(node, doc, true));
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
