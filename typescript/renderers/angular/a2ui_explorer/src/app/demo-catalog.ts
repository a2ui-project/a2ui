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

import {Injectable} from '@angular/core';
import {AngularCatalog, BASIC_COMPONENTS, BASIC_FUNCTIONS} from '@a2ui/angular/v0_9';
import {BasicCatalogThemeSchema} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogBase as BasicCatalogBaseV10} from '@a2ui/angular';
import {iframeCatalog} from '@a2ui/catalog-iframe';
import {mcpCatalog} from '@a2ui/catalog-mcp';
import {customSliderComponentDeclaration} from './custom-slider.component';
import {customGridComponentDeclaration} from './custom-grid.component';

/**
 * A catalog specific to the demo, extending the basic catalog with custom components.
 */
@Injectable({
  providedIn: 'root',
})
export class DemoCatalog extends AngularCatalog {
  constructor() {
    super(
      'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      '0.9',
      [...BASIC_COMPONENTS, customSliderComponentDeclaration, customGridComponentDeclaration],
      BASIC_FUNCTIONS,
      BasicCatalogThemeSchema,
    );
  }
}

/**
 * A v1.0 catalog specific to the demo, extending the v1.0 basic catalog with custom components.
 */
@Injectable({
  providedIn: 'root',
})
export class DemoCatalogV10 extends BasicCatalogBaseV10 {
  constructor() {
    super({
      extraComponents: [customSliderComponentDeclaration, customGridComponentDeclaration],
    });
  }
}

/**
 * `iframeCatalog` as an `AngularCatalog`, which is what the renderer configuration takes. Its
 * components are universal Web Components, so the renderer needs `useUniversalComponents: true`
 * to render them.
 */
@Injectable({
  providedIn: 'root',
})
export class IframeDemoCatalog extends AngularCatalog {
  constructor() {
    super(
      iframeCatalog.id,
      iframeCatalog.protocolVersion,
      [...iframeCatalog.components.values()],
      [...iframeCatalog.functions.values()],
    );
  }
}

/**
 * `mcpCatalog` as an `AngularCatalog`, which is what the renderer configuration takes. Its
 * components are universal Web Components, so the renderer needs `useUniversalComponents: true`
 * to render them.
 */
@Injectable({
  providedIn: 'root',
})
export class McpDemoCatalog extends AngularCatalog {
  constructor() {
    super(
      mcpCatalog.id,
      mcpCatalog.protocolVersion,
      [...mcpCatalog.components.values()],
      [...mcpCatalog.functions.values()],
    );
  }
}
