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

import {A2uiCatalogError} from '../errors.js';
import {Catalog, CatalogApi, normalizeVersionString} from '../internal/web-core.js';
import {ProtocolVersion} from '../types.js';
import {registerCatalogDocument} from '../utils/catalog-document.js';
import {toWireProtocolVersion} from '../utils/protocol-version.js';

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
 * @param protocolVersion Version to use when the document states none.
 * @param catalogId Id to use when the document states none.
 * @returns The catalog, with its protocol version in the `v`-prefixed wire form.
 * @throws {A2uiCatalogError} If a value conflicts with the document, if nothing states an
 *     id or a version, or if the document is not a valid catalog.
 */
export function catalogFromDocument(
  document: Record<string, unknown>,
  source: string,
  protocolVersion?: ProtocolVersion,
  catalogId?: string,
): CatalogApi {
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
    normalizeVersionString(protocolVersion) !== normalizeVersionString(documentVersion)
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
    catalog = Catalog.fromJson({...document, catalogId: id}, toWireProtocolVersion(version));
  } catch (e: unknown) {
    throw new A2uiCatalogError(
      `Failed to build catalog from schema in ${source}: ${(e as Error).message}`,
    );
  }
  registerCatalogDocument(catalog, document);
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
 */
export class FileSystemCatalogProvider implements CatalogProvider {
  /**
   * Initializes the filesystem catalog provider.
   *
   * @param path File path to load the catalog from.
   * @param protocolVersion Protocol version to use when the document states none, as v0.9
   *     documents do. Throws on load if the document states a different one.
   * @param catalogId Catalog id to use when the document states none, as v0.8 documents
   *     do. Throws on load if the document states a different one.
   */
  constructor(
    readonly path: string,
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

    return catalogFromDocument(parsed, this.path, this.protocolVersion, this.catalogId);
  }
}

/**
 * Builds a catalog from an in-memory schema object.
 */
export class InMemoryCatalogProvider implements CatalogProvider {
  /**
   * Initializes the in-memory provider.
   *
   * @param catalog Raw catalog schema dictionary.
   * @param protocolVersion Protocol version to use when the schema states none. Throws on
   *     load if the schema states a different one.
   * @param catalogId Catalog id to use when the schema states none. Throws on load if the
   *     schema states a different one.
   */
  constructor(
    readonly catalog: Record<string, unknown>,
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
      this.protocolVersion,
      this.catalogId,
    );
  }
}
