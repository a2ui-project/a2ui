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

import {A2uiConfigurationError} from '../errors.js';
import type {JsonSchema} from './types.js';

/** A root schema plus the referenced documents, keyed like `CompileOptions.defs`. */
export interface SchemaDoc {
  root: JsonSchema;
  defs: Record<string, JsonSchema>;
}

/** A field with nullability, default and description resolved. */
export interface UnwrappedField {
  node: JsonSchema;
  optional: boolean;
  nullable: boolean;
  default?: unknown;
  description?: string;
  refName?: string;
}

type Obj = {[k: string]: unknown};

const isObj = (n: unknown): n is Obj => typeof n === 'object' && n !== null && !Array.isArray(n);

function decodePointer(segment: string): string {
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    // keep the raw segment
  }
  return s.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolves one `$ref` string to its target node, the document it lives in and its `$defs` name. */
function resolveRef(
  ref: string,
  doc: SchemaDoc,
  current: JsonSchema,
): {node: JsonSchema; current: JsonSchema; refName?: string} {
  const hash = ref.indexOf('#');
  const docPart = hash === -1 ? ref : ref.slice(0, hash);
  const pointer = hash === -1 ? '' : ref.slice(hash + 1);
  const candidates: JsonSchema[] = [];
  if (docPart) {
    const d = doc.defs[docPart];
    if (d === undefined) throw new A2uiConfigurationError(`Unresolved $ref document: ${ref}`);
    candidates.push(d);
  } else {
    // Local refs resolve in the current document, then fall back to the others.
    candidates.push(current, doc.root, ...Object.values(doc.defs));
  }
  const segments = pointer.split('/').slice(1).map(decodePointer);
  for (const base of candidates) {
    let node: unknown = base;
    for (const seg of segments) {
      node = isObj(node) ? node[seg] : Array.isArray(node) ? node[Number(seg)] : undefined;
      if (node === undefined) break;
    }
    if (node === undefined) continue;
    const i = segments.lastIndexOf('$defs');
    const refName = i !== -1 && i < segments.length - 1 ? segments[segments.length - 1] : undefined;
    return {node: node as JsonSchema, current: base, refName};
  }
  throw new A2uiConfigurationError(`Unresolved $ref: ${ref}`);
}

function derefIn(
  node: JsonSchema,
  doc: SchemaDoc,
  current: JsonSchema,
): {node: JsonSchema; refName?: string; current: JsonSchema} {
  let refName: string | undefined;
  const seen = new Set<string>();
  let cur = current;
  let n = node;
  while (isObj(n) && typeof n['$ref'] === 'string') {
    const ref = n['$ref'];
    const r = resolveRef(ref, doc, cur);
    const key = `${docKey(doc, r.current)}|${ref}`;
    if (seen.has(key)) throw new A2uiConfigurationError(`Cyclic $ref: ${ref}`);
    seen.add(key);
    n = r.node;
    cur = r.current;
    refName = r.refName ?? refName;
  }
  return {node: n, refName, current: cur};
}

function docKey(doc: SchemaDoc, current: JsonSchema): string {
  if (current === doc.root) return '';
  return Object.keys(doc.defs).find((k) => doc.defs[k] === current) ?? '?';
}

/**
 * Follows `$ref` chains. `refName` is the last `$defs` name followed; `doc` is the document
 * the result lives in (local refs inside it resolve there).
 */
export function deref(
  node: JsonSchema,
  doc: SchemaDoc,
): {node: JsonSchema; refName?: string; doc: SchemaDoc} {
  const r = derefIn(node, doc, doc.root);
  const out: {node: JsonSchema; refName?: string; doc: SchemaDoc} = {
    node: r.node,
    doc: r.current === doc.root ? doc : {root: r.current, defs: doc.defs},
  };
  if (r.refName !== undefined) out.refName = r.refName;
  return out;
}

/** Strips a single `null` member from `anyOf`/`oneOf`/`type`, reporting whether one was removed. */
function stripNull(node: JsonSchema): {node: JsonSchema; nullable: boolean} {
  if (!isObj(node)) return {node, nullable: false};
  for (const key of ['anyOf', 'oneOf']) {
    const opts = node[key];
    if (!Array.isArray(opts)) continue;
    const isNull = (o: unknown) => isObj(o) && o['type'] === 'null';
    if (opts.filter(isNull).length !== 1) continue;
    const rest = opts.filter((o) => !isNull(o));
    const {[key]: _drop, ...siblings} = node;
    if (rest.length === 1 && isObj(rest[0])) {
      return {node: {...siblings, ...rest[0]}, nullable: true};
    }
    return {node: {...siblings, [key]: rest}, nullable: true};
  }
  const t = node['type'];
  if (Array.isArray(t) && t.includes('null')) {
    const rest = t.filter((x) => x !== 'null');
    return {node: {...node, type: rest.length === 1 ? rest[0] : rest}, nullable: true};
  }
  return {node, nullable: false};
}

/** Derefs a field, strips nullability, and reads its default and description. */
export function unwrapField(node: JsonSchema, doc: SchemaDoc, required: boolean): UnwrappedField {
  const outer = isObj(node) ? node : {};
  let r = derefIn(node, doc, doc.root);
  let stripped = stripNull(r.node);
  let nullable = stripped.nullable;
  // Stripping a nullable wrapper can expose another \$ref (e.g. anyOf[{\$ref}, null]).
  while (isObj(stripped.node) && typeof stripped.node['$ref'] === 'string') {
    const next = derefIn(stripped.node, doc, r.current);
    r = {...next, refName: next.refName ?? r.refName};
    stripped = stripNull(r.node);
    nullable = nullable || stripped.nullable;
  }
  const inner = isObj(stripped.node) ? stripped.node : {};
  const def = 'default' in outer ? outer['default'] : inner['default'];
  const desc = outer['description'] ?? inner['description'];
  const out: UnwrappedField = {
    node: stripped.node,
    optional: !required,
    nullable,
    description: typeof desc === 'string' ? desc : undefined,
    refName: r.refName,
  };
  if (def !== undefined) out.default = def;
  return out;
}

/** The `anyOf`/`oneOf` members of a node, if any. */
export function unionOptions(node: JsonSchema, doc: SchemaDoc): JsonSchema[] | undefined {
  const n = deref(node, doc).node;
  if (!isObj(n)) return undefined;
  const opts = n['anyOf'] ?? n['oneOf'];
  return Array.isArray(opts) ? (opts as JsonSchema[]) : undefined;
}

/** The object shape of a node, merging `allOf` members; undefined if not object-like. */
export function objectProperties(
  node: JsonSchema,
  doc: SchemaDoc,
):
  | {
      properties: Record<string, JsonSchema>;
      required: Set<string>;
      additional: JsonSchema | undefined;
    }
  | undefined {
  const properties: Record<string, JsonSchema> = {};
  const required = new Set<string>();
  let additional: JsonSchema | undefined;
  let found = false;
  const visit = (n: JsonSchema, current: JsonSchema, depth: number) => {
    if (depth > 32) throw new A2uiConfigurationError('allOf nesting too deep');
    const r = derefIn(n, doc, current);
    if (!isObj(r.node)) return;
    const o = r.node;
    if (o['type'] === 'object') found = true;
    if (isObj(o['properties'])) {
      found = true;
      Object.assign(properties, o['properties']);
    }
    if (Array.isArray(o['required'])) {
      found = true;
      for (const k of o['required']) if (typeof k === 'string') required.add(k);
    }
    if ('additionalProperties' in o) additional = o['additionalProperties'] as JsonSchema;
    if (Array.isArray(o['allOf'])) {
      found = true;
      for (const part of o['allOf']) visit(part as JsonSchema, r.current, depth + 1);
    }
  };
  visit(node, doc.root, 0);
  return found ? {properties, required, additional} : undefined;
}

/** The `items` schema of an array node. */
export function arrayItems(node: JsonSchema, doc: SchemaDoc): JsonSchema | undefined {
  const n = deref(node, doc).node;
  return isObj(n) && n['items'] !== undefined && !Array.isArray(n['items'])
    ? (n['items'] as JsonSchema)
    : undefined;
}

/** The `$defs` name of a node via `$ref`, else a legacy `REF:<ref>|<description>` marker. */
export function refKind(node: JsonSchema, doc: SchemaDoc): string | undefined {
  if (!isObj(node)) return undefined;
  if (typeof node['$ref'] === 'string') {
    const name = deref(node, doc).refName;
    if (name) return name;
  }
  const d = node['description'];
  if (typeof d === 'string' && d.startsWith('REF:')) {
    const target = d.slice(4).split('|')[0];
    const hash = target.lastIndexOf('#');
    const name = (hash !== -1 ? target.slice(hash + 1) : target).split('/').filter(Boolean).pop();
    return name || undefined;
  }
  return undefined;
}
