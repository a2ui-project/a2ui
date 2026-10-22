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
 * Matches `catalogs/vegachart/v0_9/catalog.json`.
 */

import {z} from 'zod';

import {
  Catalog,
  type ComponentApi,
  DynamicNumberSchema,
  DynamicValueSchema,
} from '@a2ui/web_core/v0_9';
import {spec} from '@a2ui/web_core/v1_0';

import {A2uiVegaChartElement} from '../components/vegaChart.js';

/** Catalog ID of the A2UI VegaChart catalog (protocol v0.9). */
export const VEGACHART_CATALOG_ID =
  'https://a2ui.org/specification/v0_9/catalogs/vegachart/catalog.json';

const V09_COMMON_TYPES = 'https://a2ui.org/specification/v0_9/common_types.json';

/**
 * `spec` accepts either a v0.9 `DynamicValue` (a literal or a `{path}`
 * binding) or a plain object, because v0.9's `DynamicValue` has no object
 * branch. The explicit `anyOf` keeps the serialized schema identical to the
 * published `catalog.json`.
 */
const SpecValueSchema = z.union([DynamicValueSchema, z.record(z.string(), z.unknown())]);

const SpecSchema = spec(
  z.unknown().superRefine((val, ctx) => {
    const parsed = SpecValueSchema.safeParse(val);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue(issue);
      }
    }
  }),
  {
    keywords: {
      description: 'The Vega-Lite spec to render as a JSON object.',
      anyOf: [{$ref: `${V09_COMMON_TYPES}#/$defs/DynamicValue`}, {type: 'object'}],
    },
  },
);
Object.defineProperty(SpecSchema, 'description', {value: 'REF:#/$defs/DynamicValue'});

/** Component API for `VegaChart` (protocol v0.9). */
export const VegaChartApi = {
  name: 'VegaChart',
  schema: spec(
    z
      .object({
        spec: SpecSchema,
        height: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Optional height of the chart in pixels. Defaults to 290.',
        ).optional(),
      })
      .describe('Displays a Vega or Vega-Lite chart.')
      .strict(),
    {mixins: ['ComponentCommon'], required: ['spec']},
  ),
} satisfies ComponentApi;

/** `VegaChart` web component implementation (protocol v0.9). */
export const A2uiVegaChart = {
  ...VegaChartApi,
  tagName: A2uiVegaChartElement.tagName,
  element: A2uiVegaChartElement,
};

/** A2UI v0.9 catalog containing the `VegaChart` component. */
export const vegachartCatalog = new Catalog<typeof A2uiVegaChart>(
  VEGACHART_CATALOG_ID,
  '0.9',
  [A2uiVegaChart],
  [],
  {
    schemaUri: 'https://json-schema.org/draft/2020-12/schema',
    schemaId: VEGACHART_CATALOG_ID,
    declaredProtocolVersion: null,
    title: 'A2UI VegaChart Catalog',
    description:
      'Catalog for rendering Vega and Vega-Lite charts in A2UI surfaces. Declares the VegaChart component for displaying interactive data visualizations from Vega-Lite JSON specifications.',
    commonTypesUri: V09_COMMON_TYPES,
    unions: {anyComponent: true, anyFunction: true},
  },
);
