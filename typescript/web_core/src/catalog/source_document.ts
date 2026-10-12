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

import {deepCopyJson} from './schema_serializer.js';
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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the document-level options of an authored catalog document: its
 * metadata, its instructions, its authored `$defs` and a copy of the document
 * itself, which `toJson` reproduces.
 *
 * @param document The authored catalog document.
 * @returns The options, sharing no objects with `document`.
 */
export function catalogDocumentOptions(document: Readonly<JsonObject>): CatalogDocumentOptions {
  const optionalString = (key: string): string | undefined =>
    typeof document[key] === 'string' ? (document[key] as string) : undefined;
  const defs = document['$defs'];
  return {
    instructions: optionalString('instructions'),
    schemaUri: optionalString('$schema'),
    schemaId: optionalString('$id'),
    title: optionalString('title'),
    description: optionalString('description'),
    declaredProtocolVersion: optionalString('protocolVersion'),
    defs: isJsonObject(defs) ? deepCopyJson(defs) : undefined,
    sourceDocument: deepCopyJson(document as JsonObject),
  };
}

/**
 * Returns copies of a catalog's code-defined entries that carry their
 * definitions from the catalog's published document as `sourceJson`.
 *
 * An entry the document does not define is returned as it is.
 *
 * @param entries The components or functions defined in code.
 * @param document The published catalog document.
 * @param section The document section that defines the entries.
 */
export function withSourceJson<E extends ComponentApi | FunctionApi>(
  entries: readonly E[],
  document: Readonly<JsonObject>,
  section: 'components' | 'functions',
): E[] {
  const raw = document[section];
  const definitions = new Map<string, JsonObject>();
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
  return entries.map(entry => {
    const definition = definitions.get(entry.name);
    return definition ? {...entry, sourceJson: deepCopyJson(definition)} : entry;
  });
}
