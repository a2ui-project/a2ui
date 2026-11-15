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
 * A2UI VegaChart catalog for protocol v0.9.
 *
 * Loaded from `catalogs/vegachart/v0_9/catalog.json`.
 */

import {
  Catalog,
  type ComponentApi,
  type DynamicNumber,
  type DynamicValue,
  type FunctionImplementation,
} from '@a2ui/web_core/v0_9';
import type {CatalogSchema, JsonSchemaValidator} from '@a2ui/web_core/schema-engine';
import type {WebComponentImplementation} from '@a2ui/web_core/universal';

import {A2uiVegaChartElement} from '../components/vegaChart.js';
import {implementLoadedComponent, memoizeByValidator} from '../catalog_support.js';
import VegaChartCatalogDocument from './catalog.json' with {type: 'json'};

/** Catalog ID of the A2UI VegaChart catalog (protocol v0.9). */
export const VEGACHART_CATALOG_ID =
  'https://a2ui.org/specification/v0_9/catalogs/vegachart/catalog.json';

/** The published v0.9 VegaChart catalog document (`catalogs/vegachart/v0_9/catalog.json`). */
export const VEGACHART_CATALOG_DOCUMENT: Readonly<Record<string, unknown>> =
  VegaChartCatalogDocument;

/** Properties of `VegaChart` (protocol v0.9), as a message writes them. */
export interface VegaChartProps {
  /** The Vega-Lite spec: a v0.9 `DynamicValue` or a plain object. */
  spec: DynamicValue | Record<string, unknown>;
  /** Optional height of the chart in pixels. Defaults to 290. */
  height?: DynamicNumber;
}

/** Component API of `VegaChart` (protocol v0.9). */
export type VegaChartApi = ComponentApi<CatalogSchema<VegaChartProps>>;

/** `VegaChart` web component implementation (protocol v0.9). */
export type A2uiVegaChart = WebComponentImplementation<CatalogSchema<VegaChartProps>>;

/** The A2UI v0.9 catalog containing the `VegaChart` component. */
export type VegaChartCatalog = Catalog<A2uiVegaChart>;

/**
 * Builds the A2UI v0.9 VegaChart catalog from its published document, with
 * `validator` checking `VegaChart` properties. Memoised per validator.
 *
 * @param validator A JSON Schema validator, such as `createAjvValidator()`
 *   from `@a2ui/validator-ajv`.
 * @throws {A2uiConfigurationError} If `validator` is missing.
 */
export const createVegaChartCatalog: (validator: JsonSchemaValidator) => VegaChartCatalog =
  memoizeByValidator(validator => {
    const loaded = Catalog.fromJson(VegaChartCatalogDocument, '0.9', VEGACHART_CATALOG_ID, {
      validator,
    });
    const api = loaded.components.get('VegaChart') as VegaChartApi;
    const chart: A2uiVegaChart = implementLoadedComponent(api, A2uiVegaChartElement, loaded.defs);
    return loaded.withEntries<A2uiVegaChart, FunctionImplementation>([chart], []);
  });
