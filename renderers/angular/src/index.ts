/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Public API surface for A2UI Angular Renderer.
 *
 * @module @a2ui/angular
 */

export {A2UI_ANGULAR_VERSION} from './core/version';

// Core Services and Components
export {
  type RendererConfiguration,
  A2UI_RENDERER_CONFIG,
  provideA2Ui,
  A2uiRendererService,
} from './core/a2ui-renderer.service';
export {ComponentHostComponent} from './core/component-host.component';
export {SurfaceComponent} from './core/surface.component';
export {CatalogComponent} from './core/catalog_component';
export {type Child, ComponentBinder} from './core/component-binder.service';
export {
  type ComponentTemplate,
  type BoundProperty,
  type ExtendedProps,
  type ComponentApiToProps,
} from './core/types';
export {getNormalizedPath} from './core/utils';
export {
  type MarkdownRendererOptions,
  MarkdownRenderer,
  DefaultMarkdownRenderer,
  provideMarkdownRenderer,
} from './core/markdown';

// Catalog Types and Implementations
export {
  type AnyDuringSchemaAlignment,
  type AngularComponentImplementation,
  AngularCatalog,
  createComponentImplementation,
} from './catalog/types';
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

/**
 * @deprecated Legacy v0.8 re-exports. For v0.8 compatibility, import directly from '@a2ui/angular/v0_8'.
 */
export {
  Catalog,
  DEFAULT_CATALOG,
  DynamicComponent,
  MessageProcessor,
  provideA2UI,
  Renderer,
  Surface,
  Theme,
  Types,
  type DispatchedEvent,
} from '@a2ui/angular/v0_8';
