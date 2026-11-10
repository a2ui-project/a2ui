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
 * Matches `catalogs/vegachart/v1/catalog.json`.
 */

import {z} from 'zod';

import {
  Catalog,
  type ComponentApi,
  DynamicNumberSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import {A2uiVegaChartElement} from '../components/vegaChart.js';

/** Catalog ID of the A2UI VegaChart catalog (protocol v1.0). */
export const VEGACHART_V1_CATALOG_ID =
  'https://a2ui.org/specification/v1_0/catalogs/vegachart/catalog.json';

/** Component API for `VegaChart` (protocol v1.0). */
export const VegaChartV1Api = {
  name: 'VegaChart',
  schema: spec(
    z
      .object({
        spec: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|The Vega-Lite spec to render as a JSON object.',
        ),
        height: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Optional height of the chart in pixels. Defaults to 290.',
        ).optional(),
      })
      .describe('Displays a Vega or Vega-Lite chart.')
      .strict(),
    {mixins: [], required: ['spec']},
  ),
} satisfies ComponentApi;

/** `VegaChart` web component implementation (protocol v1.0). */
export const A2uiVegaChartV1 = {
  ...VegaChartV1Api,
  tagName: A2uiVegaChartElement.tagName,
  element: A2uiVegaChartElement,
};

/** A2UI v1.0 catalog containing the `VegaChart` component. */
export const vegachartV1Catalog = new Catalog<typeof A2uiVegaChartV1>(
  VEGACHART_V1_CATALOG_ID,
  '1.0',
  [A2uiVegaChartV1],
  [],
  {
    schemaUri: 'https://json-schema.org/draft/2020-12/schema',
    schemaId: VEGACHART_V1_CATALOG_ID,
    title: 'A2UI VegaChart Catalog',
    description:
      'Catalog for rendering Vega and Vega-Lite charts in A2UI surfaces. Declares the VegaChart component for displaying interactive data visualizations from Vega-Lite JSON specifications.',
  },
);
