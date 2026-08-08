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

import {
  AngularCatalog,
  AngularComponentImplementation,
  createComponentImplementation,
} from '../types';
import {
  basicCatalog,
  BASIC_FUNCTIONS,
  createBasicCatalogFunctions,
  A2uiText,
  A2uiRow,
  A2uiColumn,
  A2uiButton,
  A2uiTextField,
  A2uiImage,
  A2uiIcon,
  A2uiVideo,
  A2uiAudioPlayer,
  A2uiList,
  A2uiCard,
  A2uiTabs,
  A2uiModal,
  A2uiDivider,
  A2uiCheckBox,
  A2uiChoicePicker,
  A2uiSlider,
  A2uiDateTimeInput,
} from '@a2ui/web_core/v0_9/basic_catalog';
import {FunctionImplementation} from '@a2ui/web_core/v0_9';

import {TextComponent} from './text.component';
import {RowComponent} from './row.component';
import {ColumnComponent} from './column.component';
import {ButtonComponent} from './button.component';
import {TextFieldComponent} from './text-field.component';
import {ImageComponent} from './image.component';
import {IconComponent} from './icon.component';
import {VideoComponent} from './video.component';
import {AudioPlayerComponent} from './audio-player.component';
import {ListComponent} from './list.component';
import {CardComponent} from './card.component';
import {TabsComponent} from './tabs.component';
import {ModalComponent} from './modal.component';
import {DividerComponent} from './divider.component';
import {CheckBoxComponent} from './check-box.component';
import {ChoicePickerComponent} from './choice-picker.component';
import {SliderComponent} from './slider.component';
import {DateTimeInputComponent} from './date-time-input.component';

/**
 * The set of default Angular implementations for each component in the basic catalog.
 * Using string literals as keys, to survive property renaming, as these names need to match the JSON payload.
 */
// Ignore Prettier to preserve quoted keys, needed to survive property renaming.
// prettier-ignore
const DEFAULT_COMPONENT_IMPLEMENTATIONS: Record<string, AngularComponentImplementation> = {
  'text': createComponentImplementation(A2uiText, TextComponent),
  'row': createComponentImplementation(A2uiRow, RowComponent),
  'column': createComponentImplementation(A2uiColumn, ColumnComponent),
  'button': createComponentImplementation(A2uiButton, ButtonComponent),
  'textField': createComponentImplementation(A2uiTextField, TextFieldComponent),
  'image': createComponentImplementation(A2uiImage, ImageComponent),
  'icon': createComponentImplementation(A2uiIcon, IconComponent),
  'video': createComponentImplementation(A2uiVideo, VideoComponent),
  'audioPlayer': createComponentImplementation(A2uiAudioPlayer, AudioPlayerComponent),
  'list': createComponentImplementation(A2uiList, ListComponent),
  'card': createComponentImplementation(A2uiCard, CardComponent),
  'tabs': createComponentImplementation(A2uiTabs, TabsComponent),
  'modal': createComponentImplementation(A2uiModal, ModalComponent),
  'divider': createComponentImplementation(A2uiDivider, DividerComponent),
  'checkBox': createComponentImplementation(A2uiCheckBox, CheckBoxComponent),
  'choicePicker': createComponentImplementation(A2uiChoicePicker, ChoicePickerComponent),
  'slider': createComponentImplementation(A2uiSlider, SliderComponent),
  'dateTimeInput': createComponentImplementation(A2uiDateTimeInput, DateTimeInputComponent),
} as const;

/**
 * Interface for specifying overrides and configuration for the basic catalog.
 */
export interface BasicCatalogOptions {
  /**
   * An optional override for the catalog's unique identifier.
   */
  id?: string;

  /**
   * An optional locale to configure catalog-level formatting.
   */
  locale?: string;

  /**
   * Optional overrides for individual components in the catalog.
   */
  components?: Partial<{
    [K in keyof typeof DEFAULT_COMPONENT_IMPLEMENTATIONS]: AngularComponentImplementation;
  }>;

  /**
   * Optional additional components to include in the catalog beyond
   * the standard basic catalog components.
   *
   * @deprecated Use AngularCatalog constructor directly to combine BASIC_COMPONENTS with custom ones.
   */
  extraComponents?: AngularComponentImplementation[];

  /**
   * An optional set of function implementations to use instead of the defaults.
   *
   * @deprecated Use AngularCatalog constructor directly to combine BASIC_FUNCTIONS with custom ones.
   */
  functions?: FunctionImplementation[];
}

/**
 * The set of Angular UI components provided by the basic catalog.
 */
export const BASIC_COMPONENTS: AngularComponentImplementation[] = Object.values(
  DEFAULT_COMPONENT_IMPLEMENTATIONS,
);

/**
 * The set of client-side functions provided by the basic catalog.
 */
export {BASIC_FUNCTIONS};

/**
 * A basic catalog of components and functions for v0.9 verification.
 *
 * This catalog includes a wide range of UI components (Text, Button, Row, etc.)
 * and utility functions (formatString) defined in the A2UI v0.9
 * basic catalog specification.
 *
 * Component definitions in this catalog contain both native Angular component
 * implementations and universal Web Component tag names, allowing the renderer
 * to dynamically select between native and universal rendering based on application
 * configuration.
 */
export class BasicCatalog extends AngularCatalog<AngularComponentImplementation> {
  constructor(options: BasicCatalogOptions = {}) {
    const id = options.id ?? basicCatalog.id;
    const functions =
      options.functions ??
      (options.locale
        ? createBasicCatalogFunctions({locale: options.locale})
        : Array.from(basicCatalog.functions.values()));

    const overrides = options.components ?? {};
    const components: AngularComponentImplementation[] = [
      ...Object.entries(DEFAULT_COMPONENT_IMPLEMENTATIONS).map(([key, defaultValue]) => {
        const impl = (overrides as any)[key] ?? defaultValue;
        return {...impl, name: impl.name || key};
      }),
      ...(options.extraComponents ?? []),
    ];

    super(id, components, functions);
  }
}

/**
 * A base class for basic catalogs, providing extensibility for custom catalogs.
 */
export const BasicCatalogBase = BasicCatalog;
export type BasicCatalogBase = BasicCatalog;

export const BASIC_CATALOG = new BasicCatalog();
