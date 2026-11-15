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

import {Catalog, type CatalogSchema, type ComponentApi} from '@a2ui/web_core';
import type {ChildList, DynamicNumber, DynamicString} from '@a2ui/web_core/v0_9';
import {BASIC_CATALOG_ID} from '@a2ui/web_core/v0_9/basic_catalog';
import {validator} from './validator.js';

const COMMON_TYPES = 'https://a2ui.org/specification/v0_9/common_types.json#/$defs';

/** A v0.9 component definition: the common component fields plus `properties`. */
function componentDefinition(name: string, properties: Record<string, unknown>) {
  return {
    type: 'object',
    allOf: [
      {$ref: `${COMMON_TYPES}/ComponentCommon`},
      {
        type: 'object',
        properties: {component: {const: name}, ...properties},
        required: ['component'],
      },
    ],
    unevaluatedProperties: false,
  };
}

/**
 * The demo's custom components as a v0.9 catalog document. Their properties
 * reference the spec's common types, so the catalog finds their bindings and
 * child references, and validates them with the spec's definitions.
 */
const DEMO_COMPONENTS_DOCUMENT = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  catalogId: BASIC_CATALOG_ID,
  components: {
    CustomSlider: componentDefinition('CustomSlider', {
      label: {$ref: `${COMMON_TYPES}/DynamicString`},
      value: {$ref: `${COMMON_TYPES}/DynamicNumber`},
      min: {$ref: `${COMMON_TYPES}/DynamicNumber`},
      max: {$ref: `${COMMON_TYPES}/DynamicNumber`},
    }),
    CustomGrid: componentDefinition('CustomGrid', {
      title: {$ref: `${COMMON_TYPES}/DynamicString`},
      description: {$ref: `${COMMON_TYPES}/DynamicString`},
      children: {$ref: `${COMMON_TYPES}/ChildList`},
    }),
  },
};

const demoComponents = Catalog.fromJson(DEMO_COMPONENTS_DOCUMENT, '0.9', undefined, {validator});

function demoComponentApi<T>(name: string): ComponentApi<CatalogSchema<T>> {
  const api = demoComponents.components.get(name);
  if (!api) throw new Error(`The demo components document has no component '${name}'.`);
  return api as ComponentApi<CatalogSchema<T>>;
}

/** The properties of `CustomSlider` as a message writes them. */
export interface CustomSliderProps {
  label?: DynamicString;
  value?: DynamicNumber;
  min?: DynamicNumber;
  max?: DynamicNumber;
}

/** The properties of `CustomGrid` as a message writes them. */
export interface CustomGridProps {
  title?: DynamicString;
  description?: DynamicString;
  children?: ChildList;
}

export const customSliderApi = demoComponentApi<CustomSliderProps>('CustomSlider');
export const customGridApi = demoComponentApi<CustomGridProps>('CustomGrid');
