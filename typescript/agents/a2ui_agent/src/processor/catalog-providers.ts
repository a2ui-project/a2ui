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

import * as fs from 'fs';
import * as path from 'path';

import {A2uiCatalogError} from '../errors.js';
import {
  Catalog,
  CatalogApi,
  type JsonSchema,
  type JsonSchemaValidator,
} from '../internal/web-core.js';
import {ProtocolVersion} from '../types.js';
import {toReleaseLine, toWireProtocolVersion} from '../utils/protocol-version.js';
import {requireValidator} from '../utils/validator.js';

/**
 * Builds a catalog from a parsed catalog document, filling in the id and protocol version
 * the document leaves out.
 *
 * Older documents omit one or the other: v0.8 catalogs have no `catalogId`, and v0.9
 * catalogs have no `protocolVersion`. A provider's constructor arguments supply them. When
 * the document states a value too, the two must agree, so a provider never silently
 * overrides what the document says. When neither states a value the load fails, because a
 * catalog with no id cannot be addressed and one with no version would be validated
 * against the wrong protocol.
 *
 * Only `catalogId` counts as the document's id. `$id` is the JSON Schema identifier of the
 * document, which is not the same thing and is often a URL for the file.
 *
 * Shared by the providers and by catalog resolution, which builds inline catalogs the same
 * way. Not part of the public API.
 *
 * @param document The parsed catalog document.
 * @param source Describes where the document came from, for error messages.
 * @param validator The JSON Schema validator the catalog compiles its schemas with.
 * @param protocolVersion Version to use when the document states none.
 * @param catalogId Id to use when the document states none.
 * @param documents Documents the catalog ships with itself, keyed by basename, such as its
 *     own `common_types.json`; each replaces the protocol's document of that name.
 * @returns The catalog, with its protocol version in the `v`-prefixed wire form.
 * @throws {A2uiCatalogError} If a value conflicts with the document, if nothing states an
 *     id or a version, or if the document is not a valid catalog.
 */
export function catalogFromDocument(
  document: Record<string, unknown>,
  source: string,
  validator: JsonSchemaValidator,
  protocolVersion?: ProtocolVersion,
  catalogId?: string,
  documents?: Record<string, JsonSchema>,
): CatalogApi {
  requireValidator(validator, 'the catalog provider');
  const documentId = typeof document.catalogId === 'string' ? document.catalogId : undefined;
  if (catalogId !== undefined && documentId !== undefined && catalogId !== documentId) {
    throw new A2uiCatalogError(
      `Catalog ID mismatch in ${source}. Provider: ${catalogId}, document: ${documentId}`,
    );
  }
  const id = documentId ?? catalogId;
  if (id === undefined) {
    throw new A2uiCatalogError(
      `No catalog ID for ${source}: the document has no catalogId and the provider was given none.`,
    );
  }

  const documentVersion =
    typeof document.protocolVersion === 'string' ? document.protocolVersion : undefined;
  if (
    protocolVersion !== undefined &&
    documentVersion !== undefined &&
    toReleaseLine(protocolVersion) !== toReleaseLine(documentVersion)
  ) {
    throw new A2uiCatalogError(
      `Protocol version mismatch in ${source}. Provider: ${protocolVersion}, document: ${documentVersion}`,
    );
  }
  const version = documentVersion ?? protocolVersion;
  if (version === undefined) {
    throw new A2uiCatalogError(
      `No protocol version for ${source}: the document has no protocolVersion and the provider was given none.`,
    );
  }

  let catalog: CatalogApi;
  try {
    catalog = Catalog.fromJson(document, toWireProtocolVersion(version), id, {
      validator,
      ...(documents && Object.keys(documents).length > 0 ? {documents} : {}),
    });
  } catch (e: unknown) {
    throw new A2uiCatalogError(
      `Failed to build catalog from schema in ${source}: ${(e as Error).message}`,
    );
  }
  return catalog;
}

/**
 * Loads a catalog definition.
 */
export interface CatalogProvider {
  /**
   * Loads and returns a catalog.
   *
   * @returns The catalog instance.
   */
  load(): CatalogApi;
}

/**
 * Loads a catalog from a JSON file on disk.
 *
 * A document the catalog `$ref`s by a relative name, such as its own `common_types.json`, is
 * read from the catalog's folder when a file of that name is there, and replaces the
 * protocol's document of that name for this catalog.
 */
export class FileSystemCatalogProvider implements CatalogProvider {
  /**
   * Initializes the filesystem catalog provider.
   *
   * @param path File path to load the catalog from.
   * @param validator The JSON Schema validator the catalog compiles its schemas with, such as
   *     `createAjvValidator()` from `@a2ui/validator-ajv`.
   * @param protocolVersion Protocol version to use when the document states none, as v0.9
   *     documents do. Throws on load if the document states a different one.
   * @param catalogId Catalog id to use when the document states none, as v0.8 documents
   *     do. Throws on load if the document states a different one.
   */
  constructor(
    readonly path: string,
    readonly validator: JsonSchemaValidator,
    readonly protocolVersion?: ProtocolVersion,
    readonly catalogId?: string,
  ) {}

  /**
   * Reads the catalog JSON file and returns a Catalog instance.
   *
   * @returns The catalog instance.
   * @throws {A2uiCatalogError} If the file cannot be read or parsed, if the id or version
   *     conflicts with the document, or if nothing states an id or a version.
   */
  load(): CatalogApi {
    let content: string;
    try {
      content = fs.readFileSync(this.path, 'utf8');
    } catch (e: unknown) {
      throw new A2uiCatalogError(
        `Failed to read catalog file at ${this.path}: ${(e as Error).message}`,
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch (e: unknown) {
      throw new A2uiCatalogError(
        `Failed to parse JSON in catalog file at ${this.path}: ${(e as Error).message}`,
      );
    }

    return catalogFromDocument(
      parsed,
      this.path,
      this.validator,
      this.protocolVersion,
      this.catalogId,
      siblingDocuments(parsed, path.dirname(this.path)),
    );
  }
}

/**
 * The documents next to a catalog file that the catalog `$ref`s by a relative name, such as
 * its own `common_types.json`, keyed by basename. A name with no file next to the catalog
 * is left to the protocol's document of that name.
 *
 * @param document The parsed catalog document.
 * @param dir The folder holding the catalog file.
 * @throws {A2uiCatalogError} If a referenced sibling file is not a JSON object.
 */
function siblingDocuments(
  document: Record<string, unknown>,
  dir: string,
): Record<string, JsonSchema> {
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') {
          const name = value.split('#')[0];
          if (name && !name.includes(':') && !path.isAbsolute(name)) names.add(name);
        } else {
          visit(value);
        }
      }
    }
  };
  visit(document);

  const documents: Record<string, JsonSchema> = {};
  for (const name of names) {
    const basename = path.posix.basename(name);
    if (basename === 'catalog.json') continue;
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e: unknown) {
      throw new A2uiCatalogError(
        `Failed to read the document ${file} that the catalog refers to: ${(e as Error).message}`,
      );
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new A2uiCatalogError(
        `The document ${file} that the catalog refers to is not a JSON object.`,
      );
    }
    documents[basename] = parsed as JsonSchema;
  }
  return documents;
}

/**
 * Builds a catalog from an in-memory schema object.
 */
export class InMemoryCatalogProvider implements CatalogProvider {
  /**
   * Initializes the in-memory provider.
   *
   * @param catalog Raw catalog schema dictionary.
   * @param validator The JSON Schema validator the catalog compiles its schemas with, such as
   *     `createAjvValidator()` from `@a2ui/validator-ajv`.
   * @param protocolVersion Protocol version to use when the schema states none. Throws on
   *     load if the schema states a different one.
   * @param catalogId Catalog id to use when the schema states none. Throws on load if the
   *     schema states a different one.
   */
  constructor(
    readonly catalog: Record<string, unknown>,
    readonly validator: JsonSchemaValidator,
    readonly protocolVersion?: ProtocolVersion,
    readonly catalogId?: string,
  ) {}

  /**
   * Constructs and returns a Catalog instance from the raw schema dictionary.
   *
   * @returns The catalog instance.
   * @throws {A2uiCatalogError} If the schema is invalid, if the id or version conflicts
   *     with it, or if nothing states an id or a version.
   */
  load(): CatalogApi {
    return catalogFromDocument(
      this.catalog,
      'in-memory schema',
      this.validator,
      this.protocolVersion,
      this.catalogId,
    );
  }
}
