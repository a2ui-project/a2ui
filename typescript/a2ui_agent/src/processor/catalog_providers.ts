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
import {SchemaCatalog, ProtocolVersion} from '../types.js';
import {A2uiCatalogError} from '../errors.js';
import {Catalog} from '../internal/web_core.js';

/**
 * Normalizes a protocol version string for comparison.
 * '1.0' and 'v1.0' are considered equal.
 */
function normalizeProtocolVersion(version?: string): string | undefined {
  if (version === undefined) {
    return undefined;
  }
  return version.startsWith('v') ? version.slice(1) : version;
}

/**
 * Validates a loaded catalog against expected protocol version and ID.
 *
 * @param catalog The loaded catalog.
 * @param expectedProtocolVersion Expected protocol version.
 * @param expectedCatalogId Expected catalog ID.
 * @throws {A2uiCatalogError} If expectations are not met.
 */
function validateCatalog(
  catalog: SchemaCatalog,
  expectedProtocolVersion?: ProtocolVersion,
  expectedCatalogId?: string,
): void {
  if (expectedProtocolVersion !== undefined && catalog.protocolVersion !== undefined) {
    const expected = normalizeProtocolVersion(expectedProtocolVersion);
    const actual = normalizeProtocolVersion(catalog.protocolVersion as string);
    if (expected !== actual) {
      throw new A2uiCatalogError(
        `Protocol version mismatch. Expected: ${expectedProtocolVersion}, Actual: ${catalog.protocolVersion}`,
      );
    }
  }

  if (expectedCatalogId !== undefined && catalog.id !== expectedCatalogId) {
    throw new A2uiCatalogError(
      `Catalog ID mismatch. Expected: ${expectedCatalogId}, Actual: ${catalog.id}`,
    );
  }
}

/**
 * Loads a catalog definition.
 */
export interface CatalogProvider {
  /**
   * Loads and returns a catalog.
   *
   * Returns a promise, unlike the blueprint's synchronous `load()`, because the
   * filesystem provider uses `fs.promises`.
   *
   * @returns A promise resolving to the catalog instance.
   */
  load(): Promise<SchemaCatalog>;
}

/**
 * Loads a catalog from a JSON file on disk.
 */
export class FileSystemCatalogProvider implements CatalogProvider {
  /**
   * Initializes the filesystem catalog provider.
   *
   * @param path Expected file path to load the catalog from.
   * @param protocolVersion Expected protocol version. Throws on mismatch with the loaded catalog.
   * @param catalogId Expected catalog ID. Throws on mismatch with the loaded catalog.
   */
  constructor(
    readonly path: string,
    readonly protocolVersion?: ProtocolVersion,
    readonly catalogId?: string,
  ) {}

  /**
   * Reads the catalog JSON file and returns a Catalog instance.
   *
   * @returns A promise resolving to the catalog instance.
   * @throws {A2uiCatalogError} If file cannot be read, parsed, or if metadata validation fails.
   */
  async load(): Promise<SchemaCatalog> {
    let content: string;
    try {
      content = await fs.promises.readFile(this.path, 'utf8');
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

    let catalog: SchemaCatalog;
    try {
      catalog = Catalog.fromSchema(parsed);
    } catch (e: unknown) {
      throw new A2uiCatalogError(
        `Failed to build catalog from schema in ${this.path}: ${(e as Error).message}`,
      );
    }

    validateCatalog(catalog, this.protocolVersion, this.catalogId);
    return catalog;
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
   * @param protocolVersion Expected protocol version. Throws on mismatch with the built catalog.
   * @param catalogId Expected catalog ID. Throws on mismatch with the built catalog.
   */
  constructor(
    readonly catalog: Record<string, unknown>,
    readonly protocolVersion?: ProtocolVersion,
    readonly catalogId?: string,
  ) {}

  /**
   * Constructs and returns a Catalog instance from the raw schema dictionary.
   *
   * @returns A promise resolving to the catalog instance.
   * @throws {A2uiCatalogError} If schema is invalid or metadata validation fails.
   */
  async load(): Promise<SchemaCatalog> {
    let parsedCatalog: SchemaCatalog;
    try {
      parsedCatalog = Catalog.fromSchema(this.catalog);
    } catch (e: unknown) {
      throw new A2uiCatalogError(
        `Failed to build catalog from in-memory schema: ${(e as Error).message}`,
      );
    }

    validateCatalog(parsedCatalog, this.protocolVersion, this.catalogId);
    return parsedCatalog;
  }
}
