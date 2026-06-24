/**
 * Copyright 2026 Google LLC
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

import {Inject, Injectable, InjectionToken, Optional} from '@angular/core';
import {AngularCatalog, AngularComponentImplementation} from '../types';
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
} from '@a2ui/web_core/v0_9/basic_catalog';
import {FunctionImplementation} from '@a2ui/web_core/v0_9';

/**
 * The set of default Angular implementations for each component in the basic catalog.
 * Using string literals as keys, to survive property renaming, as these names need to match the JSON payload.
 */
// Ignore Prettier to preserve quoted keys, needed to survive property renaming.
// prettier-ignore
const DEFAULT_COMPONENT_IMPLEMENTATIONS: Record<string, AngularComponentImplementation> = {
  'text': {...TextApi, component: TextComponent},
  'row': {...RowApi, component: RowComponent},
  'column': {...ColumnApi, component: ColumnComponent},
  'button': {...ButtonApi, component: ButtonComponent},
  'textField': {...TextFieldApi, component: TextFieldComponent},
  'image': {...ImageApi, component: ImageComponent},
  'icon': {...IconApi, component: IconComponent},
  'video': {...VideoApi, component: VideoComponent},
  'audioPlayer': {...AudioPlayerApi, component: AudioPlayerComponent},
  'list': {...ListApi, component: ListComponent},
  'card': {...CardApi, component: CardComponent},
  'tabs': {...TabsApi, component: TabsComponent},
  'modal': {...ModalApi, component: ModalComponent},
  'divider': {...DividerApi, component: DividerComponent},
  'checkBox': {...CheckBoxApi, component: CheckBoxComponent},
  'choicePicker': {...ChoicePickerApi, component: ChoicePickerComponent},
  'slider': {...SliderApi, component: SliderComponent},
  'dateTimeInput': {...DateTimeInputApi, component: DateTimeInputComponent},
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
   */
  extraComponents?: AngularComponentImplementation[];

  /**
   * An optional set of function implementations to use instead of the defaults.
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

    super(id, components, functions);
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
