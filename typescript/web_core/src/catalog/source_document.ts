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

import type {CatalogOptions, ComponentApi, FunctionApi} from './types.js';

type JsonObject = Record<string, unknown>;

/** The `CatalogOptions` a catalog document supplies itself. */
export type CatalogDocumentOptions = Pick<
  CatalogOptions,
  | 'instructions'
  | 'schemaUri'
  | 'schemaId'
  | 'title'
  | 'description'
  | 'declaredProtocolVersion'
  | 'defs'
  | 'sourceDocument'
>;

/**
 * The authored definition of a catalog entry, with the definitions of its
 * catalog document that it references locally (`#/$defs/<name>`), so the entry
 * can be serialized into a catalog that does not define them itself.
 */
export interface EntrySource {
  /** The entry's definition as authored. Deeply frozen. */
  readonly json: Readonly<JsonObject>;
  /** The local definitions `json` reaches, by name. Deeply frozen. */
  readonly defs: Readonly<JsonObject>;
}

interface RecordedSource extends EntrySource {
  /** The schema the entry had when its source was recorded. */
  readonly schema: unknown;
}

/** Definition names a catalog generates itself rather than taking from an entry. */
const UNION_DEF_NAMES = new Set(['anyComponent', 'anyFunction']);

/** Sources attached to code-defined entries, such as the built-in basic catalogs'. */
const attachedSources = new WeakMap<object, RecordedSource>();

/** Sources of entries loaded from JSON, keyed by the entry's `sourceJson`. */
const loadedSources = new WeakMap<object, RecordedSource>();

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyJson<V>(value: V): V {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as V);
}

/**
 * Freezes a JSON value and everything it contains, in place.
 *
 * @param value JSON-compatible value.
 * @returns `value`.
 */
export function deepFreeze<V>(value: V): V {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Returns a deeply frozen copy of a JSON value, or the value itself when it is
 * already frozen, as the documents this module hands out are.
 *
 * @param value JSON-compatible value.
 */
export function frozenJson<V>(value: V): V {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  return deepFreeze(copyJson(value));
}

/** Collects the names of the local `#/$defs/<name>` definitions a node references. */
function collectLocalDefNames(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectLocalDefNames(item, found);
    return;
  }
  if (!isJsonObject(node)) return;
  const ref = node['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
    found.add(ref.slice('#/$defs/'.length).split('/')[0].replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  for (const value of Object.values(node)) collectLocalDefNames(value, found);
}

/**
 * Returns the definitions of `defs` that `json` reaches through local
 * references, leaving out the component and function unions, which each
 * catalog builds from its own entries.
 */
function reachedDefs(json: unknown, defs: Readonly<JsonObject>): JsonObject {
  const result: JsonObject = {};
  const pending = new Set<string>();
  collectLocalDefNames(json, pending);
  while (pending.size > 0) {
    const [name] = pending;
    pending.delete(name);
    if (name in result || UNION_DEF_NAMES.has(name) || !(name in defs)) continue;
    result[name] = defs[name];
    collectLocalDefNames(defs[name], pending);
  }
  return result;
}

function documentDefs(document: Readonly<JsonObject>): Readonly<JsonObject> {
  const defs = document['$defs'];
  return isJsonObject(defs) ? defs : {};
}

/**
 * Reads the document-level options of an authored catalog document: its
 * metadata, its instructions, its authored `$defs` and the document itself,
 * which `toJson` reproduces.
 *
 * @param document The authored catalog document.
 * @returns The options. `defs` and `sourceDocument` are deeply frozen and share
 *     no objects with `document` unless it was already frozen.
 */
export function catalogDocumentOptions(document: Readonly<JsonObject>): CatalogDocumentOptions {
  const sourceDocument = frozenJson(document);
  const optionalString = (key: string): string | undefined =>
    typeof sourceDocument[key] === 'string' ? (sourceDocument[key] as string) : undefined;
  const defs = sourceDocument['$defs'];
  return {
    instructions: optionalString('instructions'),
    schemaUri: optionalString('$schema'),
    schemaId: optionalString('$id'),
    title: optionalString('title'),
    description: optionalString('description'),
    declaredProtocolVersion: optionalString('protocolVersion'),
    defs: isJsonObject(defs) ? defs : undefined,
    sourceDocument,
  };
}

/**
 * Attaches to a catalog's code-defined entries their definitions from the
 * catalog's published document, without copying the entries.
 *
 * `toJson` and `validationSchema` then use the definition of an entry for as
 * long as the entry keeps the schema it had here; an entry the document does
 * not define is left as it is.
 *
 * @param entries The components or functions defined in code.
 * @param document The published catalog document.
 * @param section The document section that defines the entries.
 * @returns `entries`, unchanged.
 */
export function attachSourceJson<E extends ComponentApi | FunctionApi>(
  entries: E[],
  document: Readonly<JsonObject>,
  section: 'components' | 'functions',
): E[] {
  const frozen = frozenJson(document);
  const raw = frozen[section];
  const definitions = new Map<string, Readonly<JsonObject>>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isJsonObject(item) && typeof item['name'] === 'string') {
        definitions.set(item['name'], item);
      }
    }
  } else if (isJsonObject(raw)) {
    for (const [name, definition] of Object.entries(raw)) {
      if (isJsonObject(definition)) definitions.set(name, definition);
    }
  }
  const defs = documentDefs(frozen);
  for (const entry of entries) {
    const json = definitions.get(entry.name);
    if (!json) continue;
    attachedSources.set(entry, {
      json,
      defs: Object.freeze(reachedDefs(json, defs)),
      schema: entry.schema,
    });
  }
  return entries;
}

/**
 * Records the source of an entry loaded from a catalog document, so that its
 * `sourceJson` is honored only while the entry keeps `schema`.
 *
 * @param sourceJson The entry's `sourceJson`, owned by the loader. It is frozen
 *     in place.
 * @param schema The schema the loader built for the entry.
 * @param document The (frozen) catalog document the entry was loaded from.
 */
export function recordLoadedSource(
  sourceJson: JsonObject,
  schema: unknown,
  document: Readonly<JsonObject>,
): void {
  deepFreeze(sourceJson);
  loadedSources.set(sourceJson, {
    json: sourceJson,
    defs: Object.freeze(reachedDefs(sourceJson, documentDefs(document))),
    schema,
  });
}

/**
 * Returns the authored definition `toJson` and `validationSchema` use for an
 * entry, or `undefined` when they should serialize the entry's model.
 *
 * A source recorded for the entry, attached or loaded, applies only while the
 * entry keeps the schema it was recorded with, so an entry copied with a new
 * schema is serialized from that schema. A `sourceJson` set by hand, which
 * was never recorded, is used as it is.
 *
 * @param entry A component or function.
 */
export function entrySource(entry: ComponentApi | FunctionApi): EntrySource | undefined {
  const attached = attachedSources.get(entry);
  if (attached && entry.sourceJson === undefined) {
    return attached.schema === entry.schema ? attached : undefined;
  }
  const json = entry.sourceJson;
  if (json === undefined) return undefined;
  const loaded = loadedSources.get(json);
  if (loaded) return loaded.schema === entry.schema ? loaded : undefined;
  return {json, defs: {}};
}

/**
 * Returns a catalog's authored definitions together with the local
 * definitions its entries' sources reach that the catalog does not define,
 * such as the mixin of a built-in component reused in another catalog.
 *
 * @param defs The catalog's own authored definitions, if any.
 * @param entries The catalog's components and functions.
 */
export function definitionsWithEntrySources(
  defs: Readonly<JsonObject> | undefined,
  entries: Iterable<ComponentApi | FunctionApi>,
): Readonly<JsonObject> {
  let merged: JsonObject | undefined;
  for (const entry of entries) {
    const source = entrySource(entry);
    if (!source) continue;
    for (const [name, def] of Object.entries(source.defs)) {
      if ((merged ?? defs ?? {})[name] !== undefined) continue;
      merged ??= {...defs};
      merged[name] = def;
    }
  }
  return merged ?? defs ?? {};
}
