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
 * Public API surface for A2UI Angular Renderer v0.9.
 *
 * This module provides the core services, components, and catalogs required
 * to render A2UI surfaces using the v0.9 protocol.
 *
 * @module v0.9
 */

// Core Services and Components re-exported from @a2ui/angular
export {
  A2uiRendererService,
  A2UI_RENDERER_CONFIG,
  type RendererConfiguration,
  ComponentHostComponent,
  type ComponentKey,
  AccessibilityTargetDirective,
  ValidationErrorsDirective,
  SurfaceComponent,
  SurfaceNodeResolver,
  CatalogComponent,
  ComponentBinder,
  type Child,
  type BoundProperty,
  type ComponentTemplate,
  type ComponentApiToProps,
  getNormalizedPath,
  DefaultMarkdownRenderer,
  MarkdownRenderer,
  provideMarkdownRenderer,
  AngularCatalog,
  type AngularComponentImplementation,
  createComponentImplementation,
  toWebComponent,
  UniversalOnlyComponent,
  provideA2Ui,
} from '@a2ui/angular';

// Catalog Types and Implementations
export {
  type BasicCatalogOptions,
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  BasicCatalogBase,
  BASIC_CATALOG_OPTIONS,
  BasicCatalog,
} from './catalog/basic/basic-catalog';

// Basic Catalog Components
export {TextComponent} from './catalog/basic/text.component';
export {RowComponent} from './catalog/basic/row.component';
export {ColumnComponent} from './catalog/basic/column.component';
export {ButtonComponent} from './catalog/basic/button.component';
export {TextFieldComponent} from './catalog/basic/text-field.component';
export {ImageComponent} from './catalog/basic/image.component';
export {IconComponent} from './catalog/basic/icon.component';
export {VideoComponent} from './catalog/basic/video.component';
export {AudioPlayerComponent} from './catalog/basic/audio-player.component';
export {ListComponent} from './catalog/basic/list.component';
export {CardComponent} from './catalog/basic/card.component';
export {TabsComponent} from './catalog/basic/tabs.component';
export {ModalComponent} from './catalog/basic/modal.component';
export {DividerComponent} from './catalog/basic/divider.component';
export {CheckBoxComponent} from './catalog/basic/check-box.component';
export {ChoicePickerComponent} from './catalog/basic/choice-picker.component';
export {SliderComponent} from './catalog/basic/slider.component';
export {DateTimeInputComponent} from './catalog/basic/date-time-input.component';
