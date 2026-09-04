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

import {Inject, Injectable, InjectionToken, Optional} from '@angular/core';
import {
  AngularCatalog,
  AngularComponentImplementation,
  createComponentImplementation,
} from '../types';
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

import {
  BASIC_FUNCTIONS,
  createBasicCatalogFunctions,
  TextApi,
  RowApi,
  ColumnApi,
  ButtonApi,
  TextFieldApi,
  ImageApi,
  IconApi,
  VideoApi,
  AudioPlayerApi,
  ListApi,
  CardApi,
  TabsApi,
  ModalApi,
  DividerApi,
  CheckBoxApi,
  ChoicePickerApi,
  SliderApi,
  DateTimeInputApi,
  BasicCatalogThemeSchema,
  type BasicCatalogTheme,
} from '@a2ui/web_core/v0_9/basic_catalog';
import {FunctionImplementation} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

/**
 * The set of default Angular implementations for each component in the basic catalog.
 * Using string literals as keys, to survive property renaming, as these names need to match the JSON payload.
 */
// Ignore Prettier to preserve quoted keys, needed to survive property renaming.
// prettier-ignore
const DEFAULT_COMPONENT_IMPLEMENTATIONS: Record<string, AngularComponentImplementation> = {
  'text': createComponentImplementation(TextApi, TextComponent),
  'row': createComponentImplementation(RowApi, RowComponent),
  'column': createComponentImplementation(ColumnApi, ColumnComponent),
  'button': createComponentImplementation(ButtonApi, ButtonComponent),
  'textField': createComponentImplementation(TextFieldApi, TextFieldComponent),
  'image': createComponentImplementation(ImageApi, ImageComponent),
  'icon': createComponentImplementation(IconApi, IconComponent),
  'video': createComponentImplementation(VideoApi, VideoComponent),
  'audioPlayer': createComponentImplementation(AudioPlayerApi, AudioPlayerComponent),
  'list': createComponentImplementation(ListApi, ListComponent),
  'card': createComponentImplementation(CardApi, CardComponent),
  'tabs': createComponentImplementation(TabsApi, TabsComponent),
  'modal': createComponentImplementation(ModalApi, ModalComponent),
  'divider': createComponentImplementation(DividerApi, DividerComponent),
  'checkBox': createComponentImplementation(CheckBoxApi, CheckBoxComponent),
  'choicePicker': createComponentImplementation(ChoicePickerApi, ChoicePickerComponent),
  'slider': createComponentImplementation(SliderApi, SliderComponent),
  'dateTimeInput': createComponentImplementation(DateTimeInputApi, DateTimeInputComponent),
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

  /**
   * Optional theme schema to override default basic catalog theme schema.
   */
  themeSchema?: z.ZodType<BasicCatalogTheme>;
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
 * A base class for basic catalogs, providing extensibility for non-DI use cases.
 */
export class BasicCatalogBase extends AngularCatalog {
  constructor(options: BasicCatalogOptions = {}) {
    const id = options.id ?? 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
    const functions = options.functions ?? createBasicCatalogFunctions({locale: options.locale});

    const overrides = options.components ?? {};
    const components: AngularComponentImplementation[] = [
      ...Object.entries(DEFAULT_COMPONENT_IMPLEMENTATIONS).map(([key, defaultValue]) => {
        const impl = (overrides as any)[key] ?? defaultValue;
        return {...impl, name: impl.name || key};
      }),
      ...(options.extraComponents ?? []),
    ];

    super(id, components, functions, options.themeSchema ?? BasicCatalogThemeSchema);
  }
}

export const BASIC_CATALOG_OPTIONS = new InjectionToken<BasicCatalogOptions>(
  'BASIC_CATALOG_OPTIONS',
);

/**
 * A basic catalog of components and functions for v0.9 verification.
 *
 * This catalog includes a wide range of UI components (Text, Button, Row, etc.)
 * and utility functions (formatString) defined in the A2UI v0.9
 * basic catalog specification.
 */
@Injectable({
  providedIn: 'root',
})
export class BasicCatalog extends BasicCatalogBase {
  constructor(@Optional() @Inject(BASIC_CATALOG_OPTIONS) options?: BasicCatalogOptions) {
    super(options ?? {});
  }
}
