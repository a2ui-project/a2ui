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
 * A2UI VegaChart catalog.
 *
 * Import `@a2ui/catalog-vegachart/v0_9` or `@a2ui/catalog-vegachart/v1` for a
 * single protocol version. This root entry re-exports both.
 */

export {
  A2uiVegaChartElement,
  calculateFacetSize,
  DEFAULT_HEIGHT,
  type FacetSize,
  FALLBACK_WIDTH_PX,
  transformSpec,
  type VegaEmbedFn,
  type VegaEmbedOptions,
  type VegaEmbedResult,
} from './components/vegaChart.js';
export {A2uiVegaChart, VEGACHART_CATALOG_ID, VegaChartApi, vegachartCatalog} from './v0_9/index.js';
export {
  A2uiVegaChartV1,
  VEGACHART_V1_CATALOG_ID,
  VegaChartV1Api,
  vegachartV1Catalog,
} from './v1/index.js';
