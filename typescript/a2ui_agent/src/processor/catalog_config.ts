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

import {SchemaCatalog} from '../types.js';
import {CatalogTransformer} from '../catalog_transformers/base.js';
import {FileSystemCatalogProvider} from './catalog_providers.js';

/**
 * Associates a catalog with the transformations to apply to it.
 */
export class CatalogConfig {
  private _transformedCatalogMemo?: SchemaCatalog;

  /**
   * Initializes a CatalogConfig.
   *
   * @param catalog The resolved catalog instance.
   * @param transformers Optional list of transformers to apply sequentially.
   */
  constructor(
    readonly catalog: SchemaCatalog,
    readonly transformers?: CatalogTransformer[],
  ) {}

  /**
   * The catalog with all configured transformers applied in order.
   *
   * @remarks
   * This property memoizes the transformed catalog instance on first access.
   * Modifying the `transformers` array after accessing this getter will not
   * recompute the transformed catalog.
   */
  get transformedCatalog(): SchemaCatalog {
    if (!this._transformedCatalogMemo) {
      let current = this.catalog;
      if (this.transformers) {
        for (const t of this.transformers) {
          current = t.transform(current);
        }
      }
      this._transformedCatalogMemo = current;
    }
    return this._transformedCatalogMemo;
  }

  /**
   * Loads a catalog from disk into a CatalogConfig.
   *
   * @param catalogPath Path to the catalog JSON file.
   * @param transformers Optional list of catalog transformers.
   * @returns A promise resolving to a CatalogConfig instance.
   */
  static async fromPath(
    catalogPath: string,
    transformers?: CatalogTransformer[],
  ): Promise<CatalogConfig> {
    const provider = new FileSystemCatalogProvider(catalogPath);
    const catalog = await provider.load();
    return new CatalogConfig(catalog, transformers);
  }
}
