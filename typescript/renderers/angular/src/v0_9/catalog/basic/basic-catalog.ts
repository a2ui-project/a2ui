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

import {Inject, Injectable, InjectionToken, Optional, Type} from '@angular/core';
import {
  AngularCatalog,
  AngularComponentImplementation,
  type CatalogComponentInstance,
  createComponentImplementation,
  injectA2uiValidator,
} from '@a2ui/angular';
import {
  createBasicCatalog,
  createBasicCatalogFunctions,
  type BasicCatalog as WebCoreBasicCatalog,
  type BasicCatalogTheme,
} from '@a2ui/web_core/v0_9/basic_catalog';
import type {CatalogSchema, JsonSchemaValidator} from '@a2ui/web_core';
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
 * The Angular component of each component in the basic catalog, with the name of its component.
 * Using string literals as keys, to survive property renaming, as these names need to match the JSON payload.
 */
// Ignore Prettier to preserve quoted keys, needed to survive property renaming.
// prettier-ignore
const DEFAULT_COMPONENT_CLASSES: Record<string, readonly [string, Type<CatalogComponentInstance>]> = {
  'text': ['Text', TextComponent],
  'row': ['Row', RowComponent],
  'column': ['Column', ColumnComponent],
  'button': ['Button', ButtonComponent],
  'textField': ['TextField', TextFieldComponent],
  'image': ['Image', ImageComponent],
  'icon': ['Icon', IconComponent],
  'video': ['Video', VideoComponent],
  'audioPlayer': ['AudioPlayer', AudioPlayerComponent],
  'list': ['List', ListComponent],
  'card': ['Card', CardComponent],
  'tabs': ['Tabs', TabsComponent],
  'modal': ['Modal', ModalComponent],
  'divider': ['Divider', DividerComponent],
  'checkBox': ['CheckBox', CheckBoxComponent],
  'choicePicker': ['ChoicePicker', ChoicePickerComponent],
  'slider': ['Slider', SliderComponent],
  'dateTimeInput': ['DateTimeInput', DateTimeInputComponent],
} as const;

const defaultImplementations = new WeakMap<
  JsonSchemaValidator,
  Record<string, AngularComponentImplementation>
>();

/**
 * The default Angular implementation of each basic catalog component, keyed like
 * {@link DEFAULT_COMPONENT_CLASSES}: the component APIs of web_core's v0.9 basic catalog for
 * `validator`, paired with the Angular components. Built once per validator.
 */
function defaultComponentImplementations(
  validator: JsonSchemaValidator,
): Record<string, AngularComponentImplementation> {
  const base = createBasicCatalog(validator);
  let implementations = defaultImplementations.get(validator);
  if (!implementations) {
    implementations = {};
    for (const [key, [name, component]] of Object.entries(DEFAULT_COMPONENT_CLASSES)) {
      implementations[key] = createComponentImplementation(base.components.get(name)!, component);
    }
    defaultImplementations.set(validator, implementations);
  }
  return implementations;
}

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
    [K in keyof typeof DEFAULT_COMPONENT_CLASSES]: AngularComponentImplementation;
  }>;

  /**
   * Optional additional components to include in the catalog beyond
   * the standard basic catalog components.
   *
   * @deprecated Use AngularCatalog constructor directly to combine `createBasicComponents(validator)`
   *   with custom ones.
   */
  extraComponents?: AngularComponentImplementation[];

  /**
   * An optional set of function implementations to use instead of the defaults.
   *
   * @deprecated Use AngularCatalog constructor directly to combine
   *   `createBasicCatalogFunctions(validator)` with custom ones.
   */
  functions?: FunctionImplementation[];

  /**
   * Optional theme schema to override default basic catalog theme schema.
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
 * Returns the Angular UI components of the basic catalog, built with `validator`.
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
 * Returns the client-side functions of the basic catalog: the v0.9 specification's functions and
 * the legacy functions of `@a2ui/web_core` 0.9.x.
 */
export {createBasicCatalogFunctions};

/**
 * A base class for basic catalogs, providing extensibility for non-DI use cases.
 *
 * The catalog keeps the document fields of the published v0.9 basic catalog, such as its `$defs`
 * and theme.
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
        return {...impl, name: impl.name || key};
      }),
      ...(options.extraComponents ?? []),
    ];

    super(id, '0.9', components, functions, {
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
  'BASIC_CATALOG_OPTIONS',
);

/**
 * A basic catalog of components and functions for v0.9 verification.
 *
 * This catalog includes a wide range of UI components (Text, Button, Row, etc.)
 * and utility functions (formatString) defined in the A2UI v0.9
 * basic catalog specification. It validates with the validator provided with
 * `provideA2uiValidator`, unless `BASIC_CATALOG_OPTIONS` sets one.
 */
@Injectable({
  providedIn: 'root',
})
export class BasicCatalog extends BasicCatalogBase {
  constructor(@Optional() @Inject(BASIC_CATALOG_OPTIONS) options?: BasicCatalogOptions) {
    super({...options, validator: options?.validator ?? injectA2uiValidator()});
  }
}
