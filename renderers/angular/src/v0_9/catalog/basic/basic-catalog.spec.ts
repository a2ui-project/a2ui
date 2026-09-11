/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {TestBed} from '@angular/core/testing';
import {
  BasicCatalog,
  BasicCatalogBase,
  BASIC_CATALOG_ID,
  BASIC_CATALOG_OPTIONS,
  LEGACY_BASIC_CATALOG_ID,
} from './basic-catalog';

describe('BasicCatalog', () => {
  it('should be created with default options when no token is provided', () => {
    TestBed.configureTestingModule({
      providers: [BasicCatalog],
    });

    const catalog = TestBed.inject(BasicCatalog);
    expect(catalog).toBeTruthy();
    expect(catalog.id).toBe('https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json');
  });

  it('should be created with custom options when token is provided', () => {
    TestBed.configureTestingModule({
      providers: [
        BasicCatalog,
        {
          provide: BASIC_CATALOG_OPTIONS,
          useValue: {
            id: 'https://example.com/custom-catalog.json',
          },
        },
      ],
    });

    const catalog = TestBed.inject(BasicCatalog);
    expect(catalog).toBeTruthy();
    expect(catalog.id).toBe('https://example.com/custom-catalog.json');
  });

  describe('legacy catalog id aliases', () => {
    const LEGACY_ID = LEGACY_BASIC_CATALOG_ID;

    it('aliases the legacy basic catalog id when using the default id', () => {
      TestBed.configureTestingModule({
        providers: [BasicCatalog],
      });

      const catalog = TestBed.inject(BasicCatalog);
      expect(catalog.aliases).toEqual([LEGACY_ID]);
    });

    it('keeps aliasing the legacy id when only non-id options are customized', () => {
      TestBed.configureTestingModule({
        providers: [
          BasicCatalog,
          {
            provide: BASIC_CATALOG_OPTIONS,
            useValue: {locale: 'fr-FR'},
          },
        ],
      });

      const catalog = TestBed.inject(BasicCatalog);
      expect(catalog.id).toBe('https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json');
      expect(catalog.aliases).toEqual([LEGACY_ID]);
    });

    it('does not attach the legacy alias to a catalog given a custom id', () => {
      // A custom catalog is not the basic catalog, so claiming the legacy basic
      // id would let it capture surfaces meant for the real one.
      TestBed.configureTestingModule({
        providers: [
          BasicCatalog,
          {
            provide: BASIC_CATALOG_OPTIONS,
            useValue: {id: 'https://example.com/custom-catalog.json'},
          },
        ],
      });

      const catalog = TestBed.inject(BasicCatalog);
      expect(catalog.aliases).toBeUndefined();
    });

    it('keeps the alias when the canonical id is passed explicitly', () => {
      // Aliasing is keyed off the resolved id, so spelling out the canonical id
      // must behave identically to omitting it.
      TestBed.configureTestingModule({
        providers: [
          BasicCatalog,
          {
            provide: BASIC_CATALOG_OPTIONS,
            useValue: {id: BASIC_CATALOG_ID},
          },
        ],
      });

      const catalog = TestBed.inject(BasicCatalog);
      expect(catalog.id).toBe(BASIC_CATALOG_ID);
      expect(catalog.aliases).toEqual([LEGACY_ID]);
    });

    it('applies the same alias rules when constructed directly', () => {
      expect(new BasicCatalogBase().aliases).toEqual([LEGACY_ID]);
      expect(new BasicCatalogBase({id: BASIC_CATALOG_ID}).aliases).toEqual([LEGACY_ID]);
      expect(new BasicCatalogBase({id: 'https://example.com/custom.json'}).aliases).toBeUndefined();
    });
  });
});
