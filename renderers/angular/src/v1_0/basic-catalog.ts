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
  makeEnvironmentProviders,
  Optional,
} from '@angular/core';
import {
  A2UI_RENDERER_CONFIG,
  AngularCatalog,
  AngularComponentImplementation,
  createComponentImplementation,
  RendererConfiguration,
  UniversalOnlyComponent,
} from '@a2ui/angular/v0_9';
import {
  BASIC_FUNCTIONS,
  createBasicCatalogFunctions,
  BasicCatalogThemeSchema,
  type BasicCatalogTheme,
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
} from '@a2ui/web_core/catalogs/basic/v1';
import {FunctionImplementation} from '@a2ui/web_core/v1_0';
import {z} from 'zod';

/**
 * The set of default Angular universal implementations for each component in the v1.0 basic catalog.
 * Using string literals as keys, to survive property renaming, as these names need to match the JSON payload.
 */
// Ignore Prettier to preserve quoted keys, needed to survive property renaming.
// prettier-ignore
const DEFAULT_COMPONENT_IMPLEMENTATIONS: Record<string, AngularComponentImplementation> = {
  'text': createComponentImplementation(A2uiText, UniversalOnlyComponent),
  'row': createComponentImplementation(A2uiRow, UniversalOnlyComponent),
  'column': createComponentImplementation(A2uiColumn, UniversalOnlyComponent),
  'button': createComponentImplementation(A2uiButton, UniversalOnlyComponent),
  'textField': createComponentImplementation(A2uiTextField, UniversalOnlyComponent),
  'image': createComponentImplementation(A2uiImage, UniversalOnlyComponent),
  'icon': createComponentImplementation(A2uiIcon, UniversalOnlyComponent),
  'video': createComponentImplementation(A2uiVideo, UniversalOnlyComponent),
  'audioPlayer': createComponentImplementation(A2uiAudioPlayer, UniversalOnlyComponent),
  'list': createComponentImplementation(A2uiList, UniversalOnlyComponent),
  'card': createComponentImplementation(A2uiCard, UniversalOnlyComponent),
  'tabs': createComponentImplementation(A2uiTabs, UniversalOnlyComponent),
  'modal': createComponentImplementation(A2uiModal, UniversalOnlyComponent),
  'divider': createComponentImplementation(A2uiDivider, UniversalOnlyComponent),
  'checkBox': createComponentImplementation(A2uiCheckBox, UniversalOnlyComponent),
  'choicePicker': createComponentImplementation(A2uiChoicePicker, UniversalOnlyComponent),
  'slider': createComponentImplementation(A2uiSlider, UniversalOnlyComponent),
  'dateTimeInput': createComponentImplementation(A2uiDateTimeInput, UniversalOnlyComponent),
} as const;

/**
 * Interface for specifying overrides and configuration for the v1.0 basic catalog.
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

  /**
   * Optional theme schema to override default basic catalog theme schema.
   */
  themeSchema?: z.ZodType<BasicCatalogTheme>;
}

/**
 * The set of UI components provided by the v1.0 basic catalog.
 */
export const BASIC_COMPONENTS: AngularComponentImplementation[] = Object.values(
  DEFAULT_COMPONENT_IMPLEMENTATIONS,
);

/**
 * The set of client-side functions provided by the v1.0 basic catalog.
 */
export { BASIC_FUNCTIONS };

/**
 * A base class for v1.0 basic catalogs, providing extensibility for non-DI use cases.
 */
export class BasicCatalogBase extends AngularCatalog {
  constructor(options: BasicCatalogOptions = {}) {
    const id = options.id ?? 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
    const functions = options.functions ?? createBasicCatalogFunctions({ locale: options.locale });

    const overrides = options.components ?? {};
    const components: AngularComponentImplementation[] = [
      ...Object.entries(DEFAULT_COMPONENT_IMPLEMENTATIONS).map(([key, defaultValue]) => {
        const impl = (overrides as any)[key] ?? defaultValue;
        const result: Record<string, any> = {name: impl.name || defaultValue.name || key};
        for (const prop of Object.keys(impl)) {
          if (prop !== 'name') {
            result[prop] = (impl as any)[prop];
          }
        }
        return result as AngularComponentImplementation;
      }),
      ...(options.extraComponents ?? []),
    ];

    super(id, '1.0', components, functions, options.themeSchema ?? BasicCatalogThemeSchema);
  }
}

export const BASIC_CATALOG_OPTIONS = new InjectionToken<BasicCatalogOptions>(
  'BASIC_CATALOG_OPTIONS_V1_0',
);

/**
 * The v1.0 basic catalog of components and functions for Angular.
 */
@Injectable({
  providedIn: 'root',
})
export class BasicCatalog extends BasicCatalogBase {
  constructor(@Optional() @Inject(BASIC_CATALOG_OPTIONS) options?: BasicCatalogOptions) {
    super(options ?? {});
  }
}

/**
 * Provides the A2UI v1.0 renderer configuration, defaulting `useUniversalComponents` to `true`.
 *
 * @param configOrFactory The configuration or a factory function that returns the configuration.
 * @returns The providers for the A2UI renderer.
 */
export function provideA2UI(
  configOrFactory: RendererConfiguration | (() => RendererConfiguration),
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: A2UI_RENDERER_CONFIG,
      ...(typeof configOrFactory === 'function'
        ? {
            useFactory: () => {
              const cfg = configOrFactory();
              return { useUniversalComponents: true, ...cfg };
            },
          }
        : {
            useValue: { useUniversalComponents: true, ...configOrFactory },
          }),
    },
  ]);
}
