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
  EnvironmentProviders,
  Inject,
  Injectable,
  InjectionToken,
  Injector,
  Optional,
  makeEnvironmentProviders,
} from '@angular/core';
import {
  AngularCatalog,
  AngularComponentImplementation,
  BasicCatalogComponent,
  createComponentImplementation,
} from '../types';
import {
  basicCatalog,
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
import {FunctionImplementation, WebComponentImplementation} from '@a2ui/web_core/v0_9';

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

export type {BasicCatalogComponent};

/**
 * The set of default native Angular implementations for each component in the basic catalog.
 */
// prettier-ignore
export const DEFAULT_NATIVE_COMPONENT_IMPLEMENTATIONS: Record<
  string,
  AngularComponentImplementation
> = {
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
 * The set of native Angular UI components provided by the basic catalog.
 */
export const BASIC_NATIVE_COMPONENTS: AngularComponentImplementation[] = Object.values(
  DEFAULT_NATIVE_COMPONENT_IMPLEMENTATIONS,
);

/**
 * The set of universal W3C web components provided by the basic catalog.
 */
export const BASIC_UNIVERSAL_COMPONENTS: WebComponentImplementation[] = Array.from(
  basicCatalog.components.values(),
);

/**
 * The default set of components provided by the basic catalog (defaults to universal web components).
 */
export const BASIC_COMPONENTS: BasicCatalogComponent[] = BASIC_UNIVERSAL_COMPONENTS;

/**
 * The set of client-side functions provided by the basic catalog.
 */
export {BASIC_FUNCTIONS};

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
   * When true (default), uses W3C universal web components from @a2ui/web_core.
   * When false, uses native Angular component implementations.
   */
  useUniversal?: boolean;

  /**
   * Optional overrides for individual components in the catalog.
   */
  components?: Partial<Record<string, BasicCatalogComponent>>;

  /**
   * Optional additional components to include in the catalog beyond
   * the standard basic catalog components.
   */
  extraComponents?: BasicCatalogComponent[];

  /**
   * An optional set of function implementations to use instead of the defaults.
   */
  functions?: FunctionImplementation[];
}

/**
 * A basic catalog populated with native Angular component implementations.
 */
export class NativeBasicCatalog extends AngularCatalog {
  constructor(options: BasicCatalogOptions = {}, injector?: Injector) {
    const id = options.id ?? basicCatalog.id;
    const functions =
      options.functions ??
      (options.locale
        ? createBasicCatalogFunctions({locale: options.locale})
        : Array.from(basicCatalog.functions.values()));

    const baseComponents = new Map<string, BasicCatalogComponent>(
      Object.entries(DEFAULT_NATIVE_COMPONENT_IMPLEMENTATIONS).map(([key, impl]) => [
        impl.name || key,
        impl,
      ]),
    );

    if (options.components) {
      for (const [key, comp] of Object.entries(options.components)) {
        if (comp) {
          baseComponents.set(key, comp);
        }
      }
    }

    const components: BasicCatalogComponent[] = [
      ...Array.from(baseComponents.values()),
      ...(options.extraComponents ?? []),
    ];

    super(id, components, functions, injector);
  }
}

/**
 * A basic catalog populated with universal W3C Custom Element component implementations.
 */
export class UniversalBasicCatalog extends AngularCatalog {
  constructor(options: BasicCatalogOptions = {}, injector?: Injector) {
    const id = options.id ?? basicCatalog.id;
    const functions =
      options.functions ??
      (options.locale
        ? createBasicCatalogFunctions({locale: options.locale})
        : Array.from(basicCatalog.functions.values()));

    const baseComponents = new Map<string, BasicCatalogComponent>(basicCatalog.components);
    if (options.components) {
      for (const [key, comp] of Object.entries(options.components)) {
        if (comp) {
          baseComponents.set(key, comp);
        }
      }
    }

    const components: BasicCatalogComponent[] = [
      ...Array.from(baseComponents.values()),
      ...(options.extraComponents ?? []),
    ];

    super(id, components, functions, injector);
  }
}

/**
 * A base class for basic catalogs, providing extensibility for non-DI use cases.
 */
export class BasicCatalogBase extends AngularCatalog {
  constructor(options: BasicCatalogOptions = {}, injector?: Injector) {
    const id = options.id ?? basicCatalog.id;
    const functions =
      options.functions ??
      (options.locale
        ? createBasicCatalogFunctions({locale: options.locale})
        : Array.from(basicCatalog.functions.values()));

    const useUniversal = options.useUniversal ?? true;
    const defaultComponents = useUniversal
      ? basicCatalog.components
      : new Map<string, BasicCatalogComponent>(
          Object.entries(DEFAULT_NATIVE_COMPONENT_IMPLEMENTATIONS).map(([key, impl]) => [
            impl.name || key,
            impl,
          ]),
        );

    const baseComponents = new Map<string, BasicCatalogComponent>(defaultComponents);
    if (options.components) {
      for (const [key, comp] of Object.entries(options.components)) {
        if (comp) {
          baseComponents.set(key, comp);
        }
      }
    }

    const components: BasicCatalogComponent[] = [
      ...Array.from(baseComponents.values()),
      ...(options.extraComponents ?? []),
    ];

    super(id, components, functions, injector);
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
  constructor(
    @Optional() @Inject(BASIC_CATALOG_OPTIONS) options?: BasicCatalogOptions,
    @Optional() injector?: Injector,
  ) {
    super(options ?? {}, injector);
  }
}

export const BASIC_CATALOG = new BasicCatalog();

/**
 * Configures providers for the A2UI Angular basic catalog.
 */
export function provideBasicCatalog(options: BasicCatalogOptions = {}): EnvironmentProviders {
  const useUniversal = options.useUniversal ?? true;

  return makeEnvironmentProviders([
    {
      provide: BASIC_CATALOG_OPTIONS,
      useValue: options,
    },
    {
      provide: BasicCatalog,
      useClass: useUniversal ? UniversalBasicCatalog : NativeBasicCatalog,
    },
    {
      provide: AngularCatalog,
      useExisting: BasicCatalog,
    },
  ]);
}
