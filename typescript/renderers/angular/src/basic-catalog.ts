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
import {A2UI_RENDERER_CONFIG, type RendererConfiguration} from './core/a2ui-renderer.service';
import {
  AngularCatalog,
  type AngularComponentImplementation,
  createComponentImplementation,
} from './catalog/types';
import {UniversalOnlyComponent} from './catalog/universal_only.component';
import {injectA2uiValidator} from './core/validator';
import {
  createBasicCatalog,
  createBasicCatalogFunctions,
  type BasicCatalog as WebCoreBasicCatalog,
  type BasicCatalogTheme,
} from '@a2ui/web_core/catalogs/basic/v1';
import type {CatalogSchema, FunctionImplementation, JsonSchemaValidator} from '@a2ui/web_core';

/**
 * The name of each component in the v1.0 basic catalog, which the renderer implements as universal
 * Web Components. Using string literals as keys, to survive property renaming, as these names need
 * to match the JSON payload.
 */
// Ignore Prettier to preserve quoted keys, needed to survive property renaming.
// prettier-ignore
const DEFAULT_COMPONENT_NAMES: Record<string, string> = {
  'text': 'Text',
  'row': 'Row',
  'column': 'Column',
  'button': 'Button',
  'textField': 'TextField',
  'image': 'Image',
  'icon': 'Icon',
  'video': 'Video',
  'audioPlayer': 'AudioPlayer',
  'list': 'List',
  'card': 'Card',
  'tabs': 'Tabs',
  'modal': 'Modal',
  'divider': 'Divider',
  'checkBox': 'CheckBox',
  'choicePicker': 'ChoicePicker',
  'slider': 'Slider',
  'dateTimeInput': 'DateTimeInput',
} as const;

const defaultImplementations = new WeakMap<
  JsonSchemaValidator,
  Record<string, AngularComponentImplementation>
>();

/**
 * The default Angular universal implementation of each v1.0 basic catalog component, keyed like
 * {@link DEFAULT_COMPONENT_NAMES}: the components of web_core's v1 basic catalog for `validator`.
 * Built once per validator.
 */
function defaultComponentImplementations(
  validator: JsonSchemaValidator,
): Record<string, AngularComponentImplementation> {
  const base = createBasicCatalog(validator);
  let implementations = defaultImplementations.get(validator);
  if (!implementations) {
    implementations = {};
    for (const [key, name] of Object.entries(DEFAULT_COMPONENT_NAMES)) {
      implementations[key] = createComponentImplementation(
        base.components.get(name)!,
        UniversalOnlyComponent,
      );
    }
    defaultImplementations.set(validator, implementations);
  }
  return implementations;
}

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
    [K in keyof typeof DEFAULT_COMPONENT_NAMES]: AngularComponentImplementation;
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
   * Optional theme schema. The v1.0 basic catalog declares none.
   */
  themeSchema?: CatalogSchema<BasicCatalogTheme>;

  /**
   * The JSON Schema validator the catalog's components and functions validate with, such as
   * `createAjvValidator()` from `@a2ui/validator-ajv`. Required for `BasicCatalogBase`;
   * `BasicCatalog` defaults it to the one provided with `provideA2uiValidator`.
   */
  validator?: JsonSchemaValidator;
}

/**
 * Returns the UI components of the v1.0 basic catalog, built with `validator`.
 *
 * Each call returns a new array of the same entries.
 *
 * @param validator The JSON Schema validator, such as `createAjvValidator()` from
 *   `@a2ui/validator-ajv`.
 * @throws {A2uiConfigurationError} If `validator` is missing.
 */
export function createBasicComponents(
  validator: JsonSchemaValidator,
): AngularComponentImplementation[] {
  return Object.values(defaultComponentImplementations(validator));
}

/**
 * Returns the client-side functions of the v1.0 basic catalog.
 */
export {createBasicCatalogFunctions};

/**
 * A base class for v1.0 basic catalogs, providing extensibility for non-DI use cases.
 *
 * The catalog keeps the document fields of the published v1 basic catalog, such as its `$defs`.
 *
 * @throws {A2uiConfigurationError} If `options.validator` is missing.
 */
export class BasicCatalogBase extends AngularCatalog {
  constructor(options: BasicCatalogOptions = {}) {
    const validator = options.validator as JsonSchemaValidator;
    const base: WebCoreBasicCatalog = createBasicCatalog(validator);
    const id = options.id ?? base.id;
    const functions =
      options.functions ?? createBasicCatalogFunctions(validator, {locale: options.locale});

    const defaults = defaultComponentImplementations(validator);
    const overrides = options.components ?? {};
    const components: AngularComponentImplementation[] = [
      ...Object.entries(defaults).map(([key, defaultValue]) => {
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

    super(id, '1.0', components, functions, {
      themeSchema: options.themeSchema ?? base.themeSchema,
      validator,
      schemaUri: base.schemaUri,
      declaredProtocolVersion: base.declaredProtocolVersion,
      declaresCatalogId: base.declaresCatalogId,
      declaresComponents: base.declaresComponents,
      functionsLayout: base.functionsLayout,
      unions: base.unions,
      defs: base.defs,
      extensionFields: base.extensionFields,
      commonTypesUri: base.commonTypesUri,
      themeLocation: base.themeLocation,
      // The `$id`, title and description describe the published catalog, so they are kept only
      // under its ID.
      ...(id === base.id
        ? {schemaId: base.schemaId, title: base.title, description: base.description}
        : {}),
    });
  }
}

export const BASIC_CATALOG_OPTIONS = new InjectionToken<BasicCatalogOptions>(
  'BASIC_CATALOG_OPTIONS_V1_0',
);

/**
 * The v1.0 basic catalog of components and functions for Angular.
 *
 * It validates with the validator provided with `provideA2uiValidator`, unless
 * `BASIC_CATALOG_OPTIONS` sets one.
 */
@Injectable({
  providedIn: 'root',
})
export class BasicCatalog extends BasicCatalogBase {
  constructor(@Optional() @Inject(BASIC_CATALOG_OPTIONS) options?: BasicCatalogOptions) {
    super({...options, validator: options?.validator ?? injectA2uiValidator()});
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
              return {useUniversalComponents: true, ...cfg};
            },
          }
        : {
            useValue: {useUniversalComponents: true, ...configOrFactory},
          }),
    },
  ]);
}
