/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * A2UI VegaChart catalog for protocol v1.0.
 *
 * Loaded from `catalogs/vegachart/v1/catalog.json`.
 */

import {
  Catalog,
  type ComponentApi,
  type DynamicNumber,
  type DynamicValue,
  type FunctionImplementation,
} from '@a2ui/web_core/v1_0';
import type {CatalogSchema, JsonSchemaValidator} from '@a2ui/web_core/schema-engine';
import type {WebComponentImplementation} from '@a2ui/web_core/universal';

import {A2uiVegaChartElement} from '../components/vegaChart.js';
import {implementLoadedComponent, memoizeByValidator} from '../catalog_support.js';
import VegaChartV1CatalogDocument from './catalog.json' with {type: 'json'};

/** Catalog ID of the A2UI VegaChart catalog (protocol v1.0). */
export const VEGACHART_V1_CATALOG_ID =
  'https://a2ui.org/specification/v1_0/catalogs/vegachart/catalog.json';

/** The published v1.0 VegaChart catalog document (`catalogs/vegachart/v1/catalog.json`). */
export const VEGACHART_V1_CATALOG_DOCUMENT: Readonly<Record<string, unknown>> =
  VegaChartV1CatalogDocument;

/** Properties of `VegaChart` (protocol v1.0), as a message writes them. */
export interface VegaChartV1Props {
  /** The Vega-Lite spec to render as a JSON object. */
  spec: DynamicValue;
  /** Optional height of the chart in pixels. Defaults to 290. */
  height?: DynamicNumber;
}

/** Component API of `VegaChart` (protocol v1.0). */
export type VegaChartV1Api = ComponentApi<CatalogSchema<VegaChartV1Props>>;

/** `VegaChart` web component implementation (protocol v1.0). */
export type A2uiVegaChartV1 = WebComponentImplementation<CatalogSchema<VegaChartV1Props>>;

/** The A2UI v1.0 catalog containing the `VegaChart` component. */
export type VegaChartV1Catalog = Catalog<A2uiVegaChartV1>;

/**
 * Builds the A2UI v1.0 VegaChart catalog from its published document, with
 * `validator` checking `VegaChart` properties. Memoised per validator.
 *
 * @param validator A JSON Schema validator, such as `createAjvValidator()`
 *   from `@a2ui/validator-ajv`.
 * @throws {A2uiConfigurationError} If `validator` is missing.
 */
export const createVegaChartV1Catalog: (validator: JsonSchemaValidator) => VegaChartV1Catalog =
  memoizeByValidator(validator => {
    const loaded = Catalog.fromJson(VegaChartV1CatalogDocument, '1.0', VEGACHART_V1_CATALOG_ID, {
      validator,
    });
    const api = loaded.components.get('VegaChart') as VegaChartV1Api;
    const chart: A2uiVegaChartV1 = implementLoadedComponent(api, A2uiVegaChartElement, loaded.defs);
    return loaded.withEntries<A2uiVegaChartV1, FunctionImplementation>([chart], []);
  });
