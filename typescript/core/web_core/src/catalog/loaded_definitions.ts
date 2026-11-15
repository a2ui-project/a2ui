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

/**
 * The JSON Schema definitions of the catalog entries `Catalog.fromJson`
 * loaded.
 */

/**
 * A JSON Schema object, as written in a catalog document.
 */
export type JsonSchemaObject = Readonly<Record<string, unknown>>;

/**
 * The JSON Schema definitions of the entries `Catalog.fromJson` loaded, by
 * entry. Kept out of the entries' own properties, so that a copy of an entry
 * made with object spread, which may change its `schema`, does not carry a
 * definition that no longer describes it.
 */
export function definitions(): WeakMap<object, JsonSchemaObject> {
  // Kept on the (hoisted) function rather than in a module constant, so it
  // can be used by modules that create entries while this module's import
  // cycle is still being evaluated.
  const holder = definitions as {store?: WeakMap<object, JsonSchemaObject>};
  return (holder.store ??= new WeakMap());
}

/**
 * The named `$defs` of the catalog document each loaded entry comes from, by
 * entry, so that a catalog that reuses the entry can carry the definitions
 * its definition references.
 */
export function documentDefs(): WeakMap<object, Readonly<Record<string, unknown>>> {
  const holder = documentDefs as {store?: WeakMap<object, Readonly<Record<string, unknown>>>};
  return (holder.store ??= new WeakMap());
}

/**
 * Returns the named `$defs` of the catalog document a loaded entry comes
 * from, or `undefined` for an entry defined in code.
 *
 * @param entry A component or function.
 */
export function loadedDocumentDefs(entry: object): Readonly<Record<string, unknown>> | undefined {
  return documentDefs().get(entry);
}

/**
 * Returns the JSON Schema definition of a catalog entry that
 * `Catalog.fromJson` loaded, or `undefined` for an entry defined in code.
 *
 * @param entry A component or function.
 */
export function loadedDefinition(entry: object): JsonSchemaObject | undefined {
  return definitions().get(entry);
}

/**
 * Copies the JSON Schema definition loaded by `Catalog.fromJson` from `source`
 * to `target`, when `source` has one.
 *
 * Used by `AgentFunction.fromApi` so that binding a handler to a loaded
 * `JsonFunctionApi` preserves its authored JSON Schema definition when
 * `Catalog.toJson` writes the catalog back out.
 *
 * @param source The original catalog entry.
 * @param target The wrapper entry.
 */
export function copyLoadedDefinition(source: object, target: object): void {
  const definition = definitions().get(source);
  if (definition !== undefined) {
    definitions().set(target, definition);
  }
  const defs = documentDefs().get(source);
  if (defs !== undefined) documentDefs().set(target, defs);
}
