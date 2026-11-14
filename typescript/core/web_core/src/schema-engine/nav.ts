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

/**
 * A root schema plus the referenced documents, keyed like `CompileOptions.defs`.
 * Local `#/...` refs resolve only against `root`; cross-document refs use `defs`.
 */
export interface SchemaDoc {
  root: JsonSchema;
  defs: Record<string, JsonSchema>;
}

/** A schema node paired with the document that owns it (`doc.root`). */
export interface SchemaCursor {
  node: JsonSchema;
  doc: SchemaDoc;
}

/** A field with nullability, default and description resolved. */
export interface UnwrappedField {
  node: JsonSchema;
  /** Owner document of `node`. */
  doc: SchemaDoc;
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

const withRoot = (doc: SchemaDoc, root: JsonSchema): SchemaDoc =>
  doc.root === root ? doc : {root, defs: doc.defs};

/** Resolves one `$ref` string to its target node and owning document. */
function resolveRef(
  ref: string,
  doc: SchemaDoc,
): {node: JsonSchema; doc: SchemaDoc; refName?: string} {
  const hash = ref.indexOf('#');
  const docPart = hash === -1 ? ref : ref.slice(0, hash);
  const pointer = hash === -1 ? '' : ref.slice(hash + 1);
  let base: JsonSchema = doc.root;
  if (docPart) {
    const d = doc.defs[docPart];
    if (d === undefined) throw new A2uiConfigurationError(`Unresolved $ref document: ${ref}`);
    base = d;
  }
  const segments = pointer.split('/').slice(1).map(decodePointer);
  let node: unknown = base;
  for (const seg of segments) {
    node = isObj(node) ? node[seg] : Array.isArray(node) ? node[Number(seg)] : undefined;
    if (node === undefined) throw new A2uiConfigurationError(`Unresolved $ref: ${ref}`);
  }
  // refName is the segment right after the last `$defs`.
  const i = segments.lastIndexOf('$defs');
  const refName = i !== -1 && i < segments.length - 1 ? segments[i + 1] : undefined;
  return {node: node as JsonSchema, doc: withRoot(doc, base), refName};
}

function derefCursor(c: SchemaCursor): SchemaCursor & {refName?: string} {
  let refName: string | undefined;
  const seen = new Map<JsonSchema, Set<string>>();
  let {node, doc} = c;
  while (isObj(node) && typeof node['$ref'] === 'string') {
    const ref = node['$ref'];
    const keys = seen.get(doc.root) ?? new Set<string>();
    seen.set(doc.root, keys);
    if (keys.has(ref)) throw new A2uiConfigurationError(`Cyclic $ref: ${ref}`);
    keys.add(ref);
    const r = resolveRef(ref, doc);
    node = r.node;
    doc = r.doc;
    refName = r.refName ?? refName;
  }
  return refName === undefined ? {node, doc} : {node, doc, refName};
}

/**
 * Follows `$ref` chains. `refName` is the last `$defs` name followed. `doc` is the document
 * that owns the returned node (the hop target): local refs inside `node` resolve against it.
 */
export function deref(
  node: JsonSchema,
  doc: SchemaDoc,
): {node: JsonSchema; refName?: string; doc: SchemaDoc} {
  return derefCursor({node, doc});
}

/** Strips a single `null` member from `anyOf`/`oneOf`/`type`, reporting whether one was removed. */
function stripNull(node: JsonSchema): {node: JsonSchema; nullable: boolean} {
  if (!isObj(node)) return {node, nullable: false};
  for (const key of ['anyOf', 'oneOf']) {
    const opts = node[key];
    if (!Array.isArray(opts)) continue;
    const isNull = (o: unknown) => isObj(o) && o['type'] === 'null';
    if (opts.filter(isNull).length !== 1) continue;
    const rest = opts.filter(o => !isNull(o));
    const {[key]: _drop, ...siblings} = node;
    if (rest.length === 1 && isObj(rest[0])) {
      return {node: {...siblings, ...rest[0]}, nullable: true};
    }
    return {node: {...siblings, [key]: rest}, nullable: true};
  }
  const t = node['type'];
  if (Array.isArray(t) && t.includes('null')) {
    const rest = t.filter(x => x !== 'null');
    return {node: {...node, type: rest.length === 1 ? rest[0] : rest}, nullable: true};
  }
  return {node, nullable: false};
}

/** Derefs a field, strips nullability, and reads its default and description. */
export function unwrapField(node: JsonSchema, doc: SchemaDoc, required: boolean): UnwrappedField {
  const outer = isObj(node) ? node : {};
  let r = derefCursor({node, doc});
  let stripped = stripNull(r.node);
  let nullable = stripped.nullable;
  // Stripping a nullable wrapper can expose another $ref (e.g. anyOf[{$ref}, null]).
  while (isObj(stripped.node) && typeof stripped.node['$ref'] === 'string') {
    const next = derefCursor({node: stripped.node, doc: r.doc});
    r = {...next, refName: next.refName ?? r.refName};
    stripped = stripNull(r.node);
    nullable = nullable || stripped.nullable;
  }
  const inner = isObj(stripped.node) ? stripped.node : {};
  const def = 'default' in outer ? outer['default'] : inner['default'];
  const desc = outer['description'] ?? inner['description'];
  const out: UnwrappedField = {
    node: stripped.node,
    doc: r.doc,
    optional: !required,
    nullable,
  };
  if (def !== undefined) out.default = def;
  if (typeof desc === 'string') out.description = desc;
  if (r.refName !== undefined) out.refName = r.refName;
  return out;
}

/** The `anyOf`/`oneOf` members of a node, if any, each paired with its owner document. */
export function unionOptions(node: JsonSchema, doc: SchemaDoc): SchemaCursor[] | undefined {
  const c = derefCursor({node, doc});
  if (!isObj(c.node)) return undefined;
  const opts = c.node['anyOf'] ?? c.node['oneOf'];
  return Array.isArray(opts) ? opts.map(o => ({node: o as JsonSchema, doc: c.doc})) : undefined;
}

/** The object shape of a node, merging `allOf` members; undefined if not object-like. */
export function objectProperties(
  node: JsonSchema,
  doc: SchemaDoc,
):
  | {
      properties: Record<string, SchemaCursor>;
      required: Set<string>;
      additional: SchemaCursor | undefined;
    }
  | undefined {
  const properties: Record<string, SchemaCursor> = {};
  const required = new Set<string>();
  let additional: SchemaCursor | undefined;
  let found = false;
  const visit = (n: JsonSchema, d: SchemaDoc, depth: number) => {
    if (depth > 32) throw new A2uiConfigurationError('allOf nesting too deep');
    const r = derefCursor({node: n, doc: d});
    if (!isObj(r.node)) return;
    const o = r.node;
    if (o['type'] === 'object') found = true;
    if (isObj(o['properties'])) {
      found = true;
      for (const [k, v] of Object.entries(o['properties'])) {
        properties[k] = {node: v as JsonSchema, doc: r.doc};
      }
    }
    if (Array.isArray(o['required'])) {
      found = true;
      for (const k of o['required']) if (typeof k === 'string') required.add(k);
    }
    if ('additionalProperties' in o) {
      additional = {node: o['additionalProperties'] as JsonSchema, doc: r.doc};
    }
    if (Array.isArray(o['allOf'])) {
      found = true;
      for (const part of o['allOf']) visit(part as JsonSchema, r.doc, depth + 1);
    }
  };
  visit(node, doc, 0);
  return found ? {properties, required, additional} : undefined;
}

/** The `items` schema of an array node, paired with its owner document. */
export function arrayItems(node: JsonSchema, doc: SchemaDoc): SchemaCursor | undefined {
  const c = derefCursor({node, doc});
  return isObj(c.node) && c.node['items'] !== undefined && !Array.isArray(c.node['items'])
    ? {node: c.node['items'] as JsonSchema, doc: c.doc}
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
