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

// Core Services and Components
export {
  A2UI_RENDERER_CONFIG,
  A2uiRendererService,
  provideA2Ui,
  type RendererConfiguration,
} from './core/a2ui-renderer.service';
export {ComponentHostComponent} from './core/component-host.component';
export {SurfaceComponent} from './core/surface.component';
export {CatalogComponent} from './core/catalog_component';
export {ComponentBinder, type Child} from './core/component-binder.service';
export {
  type BoundProperty,
  type ComponentApiToProps,
  type ComponentTemplate,
  type ExtendedProps,
} from './core/types';
export {getNormalizedPath} from './core/utils';
export {DefaultMarkdownRenderer, MarkdownRenderer, provideMarkdownRenderer} from './core/markdown';

// Catalog Types and Web Component utilities
export {
  AngularCatalog,
  type AngularComponentImplementation,
  type AnyDuringSchemaAlignment,
  createComponentImplementation,
} from './catalog/types';
export {toWebComponent} from './catalog/to_web_component';
export {UniversalOnlyComponent} from './catalog/universal_only.component';

// Providers and v1.0 BasicCatalog
export {
  BASIC_CATALOG_OPTIONS,
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  BasicCatalog,
  BasicCatalogBase,
  type BasicCatalogOptions,
  provideA2UI,
} from './basic-catalog';
