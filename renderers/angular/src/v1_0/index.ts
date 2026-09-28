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

/**
 * Public API surface for A2UI Angular Renderer v1.0.
 *
 * This module provides the core services, components, and catalogs required
 * to render A2UI surfaces using the v1.0 protocol.
 *
 * @module v1.0
 */

export {
  A2uiRendererService,
  A2UI_RENDERER_CONFIG,
  type RendererConfiguration,
  provideA2Ui,
  ComponentHostComponent,
  SurfaceComponent,
  CatalogComponent,
  ComponentBinder,
  type Child,
  type BoundProperty,
  type ComponentTemplate,
  type ComponentApiToProps,
  getNormalizedPath,
  MarkdownRenderer,
  provideMarkdownRenderer,
  AngularCatalog,
  type AngularComponentImplementation,
  createComponentImplementation,
  toWebComponent,
  UniversalOnlyComponent,
  TextComponent,
  RowComponent,
  ColumnComponent,
  ButtonComponent,
  TextFieldComponent,
  ImageComponent,
  IconComponent,
  VideoComponent,
  AudioPlayerComponent,
  ListComponent,
  CardComponent,
  TabsComponent,
  ModalComponent,
  DividerComponent,
  CheckBoxComponent,
  ChoicePickerComponent,
  SliderComponent,
  DateTimeInputComponent,
} from '@a2ui/angular/v0_9';

export {
  BasicCatalog,
  BasicCatalogBase,
  type BasicCatalogOptions,
  BASIC_CATALOG_OPTIONS,
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  provideA2UI,
} from './basic-catalog';

export * from '@a2ui/web_core/v1_0';
