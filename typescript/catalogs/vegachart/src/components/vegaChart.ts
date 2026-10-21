/*
 * Copyright 2026 Google LLC
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

// tslint:disable:no-new-decorators
import {css, html, LitElement, type PropertyValues} from 'lit';
import {property} from 'lit/decorators.js';
import {z} from 'zod';

import {
  A2uiController,
  A2uiLitElement,
  Catalog,
  type ComponentApi,
  DynamicNumberSchema,
  type DynamicValue,
  DynamicValueSchema,
  type FunctionImplementation,
  spec,
  specDef,
  type WebComponentImplementation,
} from '@a2ui/web_core/v1_0';

/**
 * The canonical catalog ID of the A2UI VegaChart catalog (protocol v0.9).
 * Matches `$id` and `catalogId` in `catalogs/vegachart/catalog.json`.
 */
export const VEGACHART_CATALOG_ID =
  'https://a2ui.org/specification/v0_9/catalogs/vegachart/vegachart_catalog.json';

/**
 * The canonical catalog ID of the A2UI VegaChart v1 catalog (protocol v1.0).
 * Matches `$id` and `catalogId` in `catalogs/vegachart/v1/catalog.json`.
 */
export const VEGACHART_V1_CATALOG_ID =
  'https://a2ui.org/specification/v1_0/catalogs/vegachart/catalog.json';

/** Default height of the VegaChart component in pixels when `height` is not specified. */
export const DEFAULT_HEIGHT = 290;

const MIN_FACET_WIDTH = 150;
const FACET_DEFAULT_COLUMNS = 3;
const FACET_BAR_PX = 25;
const FACET_POINT_PX = 40;
const FACET_DEFAULT_SUBPLOT_PX = 200;

const CHART_COLORS = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01', '#46BDC6'];

const DEFAULT_CHART_CONFIG = {
  background: 'transparent',
  font: 'Google Sans, Roboto, sans-serif',
  axis: {
    domainColor: '#e0e0e0',
    gridColor: '#f0f0f0',
    labelColor: '#5f6368',
    titleColor: '#202124',
    labelFontSize: 11,
    titleFontSize: 12,
    titlePadding: 10,
  },
  legend: {
    labelColor: '#5f6368',
    titleColor: '#202124',
    labelFontSize: 12,
    titleFontSize: 12,
  },
  title: {
    color: '#202124',
    fontSize: 16,
    anchor: 'start',
    offset: 16,
  },
  range: {
    category: CHART_COLORS,
  },
  view: {
    stroke: 'transparent',
  },
};

/** Result returned by a Vega embed function. */
export interface VegaEmbedResult {
  view?: {
    finalize?: () => void;
  };
  finalize?: () => void;
}

/** Options passed to the Vega embed function. */
export interface VegaEmbedOptions {
  actions?: boolean | Record<string, boolean>;
  renderer?: 'canvas' | 'svg';
  [key: string]: unknown;
}

/**
 * Signature for an embed function (such as `vega-embed` or a sandboxed Vega
 * renderer) that renders a Vega/Vega-Lite specification into a DOM element.
 */
export type VegaEmbedFn = (
  el: HTMLElement,
  spec: Record<string, unknown>,
  options?: VegaEmbedOptions,
) => Promise<VegaEmbedResult | undefined>;

async function defaultVegaEmbed(
  el: HTMLElement,
  chartSpec: Record<string, unknown>,
  options?: VegaEmbedOptions,
): Promise<VegaEmbedResult | undefined> {
  const moduleName = 'vega-embed';
  const mod = (await import(moduleName)) as {
    default?: VegaEmbedFn;
    embed?: VegaEmbedFn;
  };
  const embedFn = mod.default ?? mod.embed ?? (mod as unknown as VegaEmbedFn);
  return embedFn(el, chartSpec, options);
}

/** Common layout mixin for v0.9 catalog components. */
export const CatalogComponentCommonSchema = specDef(
  'CatalogComponentCommon',
  z.object({
    weight: z
      .number()
      .describe(
        "The relative weight of this component within a Row or Column. This corresponds to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column.",
      )
      .optional(),
  }),
);

const V09SpecSchema: z.ZodType<DynamicValue> = spec(
  z.unknown().superRefine((val, ctx) => {
    const parsed = DynamicValueSchema.safeParse(val);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue(issue);
      }
    }
  }),
  {
    keywords: {
      description: 'The Vega-Lite spec to render as a JSON object.',
      anyOf: [
        {
          $ref: 'https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicValue',
        },
        {
          type: 'object',
        },
      ],
    },
  },
);
Object.defineProperty(V09SpecSchema, 'description', {
  value: 'REF:#/$defs/DynamicValue',
});

/**
 * Component API definition for `VegaChart` (protocol v0.9).
 * Matches `catalogs/vegachart/catalog.json`.
 */
export const VegaChartApi = {
  name: 'VegaChart',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        spec: V09SpecSchema,
        height: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Optional height of the chart in pixels. Defaults to 290.',
        ).optional(),
      })
      .describe('Displays a Vega or Vega-Lite chart.')
      .strict(),
    {
      mixins: ['ComponentCommon', CatalogComponentCommonSchema],
      required: ['spec'],
    },
  ),
} satisfies ComponentApi;

/**
 * Component API definition for `VegaChart` (protocol v1.0).
 * Matches `catalogs/vegachart/v1/catalog.json`.
 */
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
        weight: z
          .number()
          .describe(
            "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column.",
          )
          .optional(),
      })
      .describe('Displays a Vega or Vega-Lite chart.')
      .strict(),
    {
      mixins: [],
      required: ['spec'],
    },
  ),
} satisfies ComponentApi;

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Extracts data values from a Vega-Lite specification.
 * Supports `data.values` as an array, or `datasets[data.name]` if `data.name` is specified.
 */
function getDataValues(vegaSpec: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = vegaSpec['data'];
  if (isPlainObject(data)) {
    if (Array.isArray(data['values'])) {
      return data['values'] as Array<Record<string, unknown>>;
    }
    if (typeof data['name'] === 'string' && isPlainObject(vegaSpec['datasets'])) {
      const dataset = vegaSpec['datasets'][data['name']];
      if (Array.isArray(dataset)) {
        return dataset as Array<Record<string, unknown>>;
      }
    }
  }
  return [];
}

/**
 * Estimates the maximum number of distinct values for a field within a single facet.
 * This is used to dynamically size faceted subplots based on their content.
 */
function estimateNumValuesInFacet(
  data: Array<Record<string, unknown>>,
  fieldObj: Record<string, unknown>,
  facetFieldName: string | undefined,
): number {
  const fieldName = fieldObj['field'];
  if (typeof fieldName !== 'string') return 0;

  if (!facetFieldName) {
    const uniqueValues = new Set(data.map(d => d[fieldName]));
    return uniqueValues.size;
  }

  const facetGroups = new Map<unknown, Set<unknown>>();
  for (const row of data) {
    const facetVal = row[facetFieldName];
    const targetVal = row[fieldName];
    let group = facetGroups.get(facetVal);
    if (!group) {
      group = new Set();
      facetGroups.set(facetVal, group);
    }
    group.add(targetVal);
  }

  let maxUnique = 0;
  for (const uniqueSet of facetGroups.values()) {
    if (uniqueSet.size > maxUnique) {
      maxUnique = uniqueSet.size;
    }
  }
  return maxUnique;
}

/**
 * Calculates appropriate dimensions and layout parameters for faceted Vega-Lite charts.
 * In Vega-Lite, `width` and `height` on a faceted spec apply to each individual subplot
 * rather than the overall chart container.
 */
function calculateFacetSize(vegaSpec: Record<string, unknown>, containerWidth: number) {
  let isFaceted = false;
  let facetFieldName: string | undefined;
  let columns = 0;

  const encoding = isPlainObject(vegaSpec['encoding']) ? vegaSpec['encoding'] : undefined;
  const facet = isPlainObject(vegaSpec['facet']) ? vegaSpec['facet'] : undefined;

  if (encoding) {
    if (isPlainObject(encoding['facet'])) {
      isFaceted = true;
      const facetDef = encoding['facet'];
      facetFieldName = typeof facetDef['field'] === 'string' ? facetDef['field'] : undefined;
      columns =
        typeof facetDef['columns'] === 'number' ? facetDef['columns'] : FACET_DEFAULT_COLUMNS;
    } else if (isPlainObject(encoding['column'])) {
      isFaceted = true;
      const colDef = encoding['column'];
      facetFieldName = typeof colDef['field'] === 'string' ? colDef['field'] : undefined;
    } else if (isPlainObject(encoding['row'])) {
      isFaceted = true;
      const rowDef = encoding['row'];
      facetFieldName = typeof rowDef['field'] === 'string' ? rowDef['field'] : undefined;
      columns = 1;
    }
  } else if (facet) {
    isFaceted = true;
    if (typeof facet['field'] === 'string') {
      facetFieldName = facet['field'];
      columns =
        typeof vegaSpec['columns'] === 'number' ? vegaSpec['columns'] : FACET_DEFAULT_COLUMNS;
    } else {
      if (isPlainObject(facet['column'])) {
        facetFieldName =
          typeof facet['column']['field'] === 'string' ? facet['column']['field'] : undefined;
      }
      if (isPlainObject(facet['row'])) {
        if (!facetFieldName) {
          facetFieldName =
            typeof facet['row']['field'] === 'string' ? facet['row']['field'] : undefined;
          columns = 1;
        }
      }
    }
  }

  if (!isFaceted) {
    return null;
  }

  const data = getDataValues(vegaSpec);

  let numFacets = 1;
  if (facetFieldName && data.length > 0) {
    const uniqueFacets = new Set(data.map(d => d[facetFieldName!]));
    numFacets = Math.max(1, uniqueFacets.size);
  }

  if (columns === 0) {
    columns = numFacets;
  }

  const effectiveCols = Math.min(numFacets, columns);
  const rows = Math.ceil(numFacets / Math.max(1, effectiveCols));

  const targetEncoding =
    encoding ||
    (isPlainObject(vegaSpec['spec']) && isPlainObject(vegaSpec['spec']['encoding'])
      ? (vegaSpec['spec']['encoding'] as Record<string, unknown>)
      : undefined);

  const markDef =
    vegaSpec['mark'] || (isPlainObject(vegaSpec['spec']) ? vegaSpec['spec']['mark'] : undefined);
  const markType = isPlainObject(markDef) ? markDef['type'] : markDef;

  let width: number | undefined;
  let height: number | undefined;

  if (targetEncoding && data.length > 0) {
    const yDef = isPlainObject(targetEncoding['y']) ? targetEncoding['y'] : undefined;
    const xDef = isPlainObject(targetEncoding['x']) ? targetEncoding['x'] : undefined;

    const isYNominalOrOrdinal =
      yDef?.['type'] === 'nominal' ||
      yDef?.['type'] === 'ordinal' ||
      (!yDef?.['type'] && yDef?.['field'] && xDef?.['type'] === 'quantitative');
    const isXNominalOrOrdinal =
      xDef?.['type'] === 'nominal' ||
      xDef?.['type'] === 'ordinal' ||
      (!xDef?.['type'] && xDef?.['field'] && yDef?.['type'] === 'quantitative');

    const pxPerItem = markType === 'bar' ? FACET_BAR_PX : FACET_POINT_PX;

    if (isYNominalOrOrdinal && yDef) {
      const numItems = estimateNumValuesInFacet(data, yDef, facetFieldName);
      if (numItems > 0) {
        height = Math.max(100, numItems * pxPerItem);
      }
    } else if (isXNominalOrOrdinal && xDef) {
      const numItems = estimateNumValuesInFacet(data, xDef, facetFieldName);
      if (numItems > 0) {
        width = Math.max(MIN_FACET_WIDTH, numItems * pxPerItem);
      }
    }
  }

  if (!width) {
    const paddingPerCol = 60;
    const availableWidth = Math.max(
      MIN_FACET_WIDTH,
      containerWidth - effectiveCols * paddingPerCol,
    );
    width = Math.max(MIN_FACET_WIDTH, Math.floor(availableWidth / Math.max(1, effectiveCols)));
  }
  if (!height) {
    height = FACET_DEFAULT_SUBPLOT_PX;
  }

  const totalEstimatedWidth = effectiveCols * (width + 60) + 40;
  const totalEstimatedHeight = rows * (height + 80) + 60;

  return {
    width,
    height,
    totalEstimatedWidth,
    totalEstimatedHeight,
  };
}

/**
 * Transforms a raw Vega-Lite specification to prepare it for responsive rendering.
 *
 * This function performs several adjustments:
 * 1. Injects default styling configuration (`DEFAULT_CHART_CONFIG`) while preserving
 *    any user-defined `config`, `axis`, and `view` overrides.
 * 2. Sets `autosize` behavior (`pad` for faceted charts, `fit` for standard charts).
 * 3. Adjusts `width` and `height` properties: for standard charts, it applies the
 *    container dimensions; for faceted charts, it calculates individual subplot dimensions
 *    using `calculateFacetSize` and applies them to the inner `spec` or top-level spec.
 * 4. Fixes temporal axis formatting where `%b` (month name) is used without `%Y` (year),
 *    updating it to `%b %Y` with a `-45` label angle to prevent ambiguous date labels.
 *
 * @param vegaSpec The raw Vega-Lite specification object.
 * @param containerHeight The target height for the chart container in pixels.
 * @param containerWidth The measured width of the chart container in pixels.
 * @returns A cloned and modified Vega-Lite specification ready for embedding.
 */
export function transformSpec(
  vegaSpec: Record<string, unknown>,
  containerHeight: number = DEFAULT_HEIGHT,
  containerWidth = 0,
  precomputedFacetSize?: ReturnType<typeof calculateFacetSize>,
): Record<string, unknown> {
  const transformedSpec = JSON.parse(JSON.stringify(vegaSpec)) as Record<string, unknown>;

  const facetSize =
    precomputedFacetSize !== undefined
      ? precomputedFacetSize
      : calculateFacetSize(transformedSpec, containerWidth);

  const existingConfig = isPlainObject(transformedSpec['config']) ? transformedSpec['config'] : {};
  const existingAxis = isPlainObject(existingConfig['axis']) ? existingConfig['axis'] : {};
  const existingView = isPlainObject(existingConfig['view']) ? existingConfig['view'] : {};

  transformedSpec['config'] = {
    ...DEFAULT_CHART_CONFIG,
    ...existingConfig,
    axis: {
      ...DEFAULT_CHART_CONFIG.axis,
      ...existingAxis,
    },
    view: {
      ...DEFAULT_CHART_CONFIG.view,
      ...existingView,
    },
  };

  if (facetSize) {
    transformedSpec['autosize'] = {
      type: 'pad',
    };
  } else {
    transformedSpec['autosize'] = {
      type: 'fit',
      contains: 'padding',
    };
  }

  // Fix axis formatting if needed (e.g. Temporal axis with %b format missing year)
  const fixAxisFormat = (encoding: Record<string, unknown>) => {
    for (const channel of ['x', 'y']) {
      const channelDef = encoding[channel];
      if (isPlainObject(channelDef)) {
        const isTemporal = channelDef['type'] === 'temporal' || Boolean(channelDef['timeUnit']);
        const axis = isPlainObject(channelDef['axis']) ? channelDef['axis'] : undefined;
        if (isTemporal && axis && typeof axis['format'] === 'string') {
          const fmt = axis['format'];
          if (fmt.includes('%b') && !fmt.includes('%Y')) {
            axis['format'] = fmt.replace('%b', '%b %Y');
            if (axis['labelAngle'] === undefined) {
              axis['labelAngle'] = -45;
            }
          }
        }
      }
    }
  };

  const fixTemporalAxes = (specObj: Record<string, unknown>) => {
    if (isPlainObject(specObj['encoding'])) {
      fixAxisFormat(specObj['encoding']);
    }
    if (Array.isArray(specObj['layer'])) {
      for (const layer of specObj['layer']) {
        if (isPlainObject(layer)) {
          fixTemporalAxes(layer);
        }
      }
    }
    if (isPlainObject(specObj['spec'])) {
      fixTemporalAxes(specObj['spec']);
    }
  };
  fixTemporalAxes(transformedSpec);

  const effectiveHeight = Number(containerHeight) || DEFAULT_HEIGHT;
  if (facetSize) {
    if (isPlainObject(transformedSpec['spec'])) {
      transformedSpec['spec']['height'] = facetSize.height;
      transformedSpec['spec']['width'] = facetSize.width;
      delete transformedSpec['height'];
      delete transformedSpec['width'];
    } else {
      transformedSpec['height'] = facetSize.height;
      transformedSpec['width'] = facetSize.width;
    }
  } else {
    transformedSpec['height'] = effectiveHeight;
    transformedSpec['width'] = containerWidth > 0 ? containerWidth : 'container';
  }

  return transformedSpec;
}

/**
 * Universal A2UI Lit custom element (`<a2ui-vega-chart>`) that renders a
 * Vega or Vega-Lite specification.
 */
export class A2uiVegaChartElement extends A2uiLitElement<
  typeof VegaChartApi | typeof VegaChartV1Api
> {
  static readonly tagName = 'a2ui-vega-chart';

  /**
   * Fallback width (in px) used when the host container reports `width: 0` on
   * two consecutive animation frames (e.g. inside an intrinsically-sized parent
   * flex item without `width: 100%`). If the container later resizes to a real
   * width, the `ResizeObserver` triggers a re-render at the measured width.
   */
  static readonly FALLBACK_WIDTH_PX = 400;

  /**
   * Default embed implementation used when an element instance does not set
   * its own `embedFn` property. Defaults to dynamically importing `vega-embed`.
   */
  static defaultEmbedFn: VegaEmbedFn = defaultVegaEmbed;

  /**
   * Optional direct Vega-Lite specification property for standalone usage
   * outside an A2UI `ComponentContext`. When rendered inside an A2UI surface,
   * `this.controller.props.spec` takes precedence.
   */
  @property({attribute: false}) spec?: Record<string, unknown> | null;

  /**
   * Optional direct height property (in px) for standalone usage outside an
   * A2UI `ComponentContext`. Defaults to `290`.
   */
  @property({attribute: false}) height: number | null = DEFAULT_HEIGHT;

  /**
   * Optional custom Vega embed function (for example a sandboxed iframe
   * renderer or a test double). Falls back to `A2uiVegaChartElement.defaultEmbedFn`.
   */
  @property({attribute: false}) embedFn?: VegaEmbedFn;

  static override styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .vega-chart-container {
      width: 100%;
      min-height: 290px;
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
    }

    .vega-chart-container iframe {
      border: none;
      width: 100%;
      height: 100%;
    }
  `;

  private resizeObserver?: ResizeObserver;
  private containerWidth = 0;
  private hasValidDimensions = false;
  private useFallbackWidth = false;
  private embedResult?: VegaEmbedResult;
  private renderAbortController?: AbortController;

  private get resolvedSpec(): Record<string, unknown> | null {
    const controllerSpec = this.controller?.props?.spec;
    const raw = controllerSpec !== undefined ? controllerSpec : this.spec;
    return isPlainObject(raw) ? raw : null;
  }

  private get resolvedHeight(): number {
    const controllerHeight = this.controller?.props?.height;
    const raw = controllerHeight !== undefined ? controllerHeight : this.height;
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HEIGHT;
  }

  /** Renders into the light DOM, like the basic catalog, so page styles reach the chart. */
  override createRenderRoot() {
    return this;
  }

  override willUpdate(changedProperties: PropertyValues) {
    super.willUpdate(changedProperties);
    const props = this.controller?.props;
    if (props && props.weight !== undefined) {
      this.style.flex = String(props.weight);
    } else if (this.style && typeof this.style.removeProperty === 'function') {
      this.style.removeProperty('flex');
    } else if (this.style) {
      this.style.flex = '';
    }
  }

  protected override createController() {
    try {
      return super.createController();
    } catch {
      return new A2uiController(this, VegaChartApi);
    }
  }

  protected override update(changedProperties: PropertyValues) {
    if (!this.controller && this.spec === undefined) {
      return;
    }
    if (typeof HTMLTemplateElement !== 'undefined') {
      if (this.controller) {
        super.update(changedProperties);
      } else {
        (
          LitElement.prototype as unknown as {
            update(changedProps: PropertyValues): void;
          }
        ).update.call(this, changedProperties);
      }
      return;
    }
    // Fallback for headless Node test environments without HTMLTemplateElement
    (
      Object.getPrototypeOf(LitElement.prototype) as {
        update(changedProps: PropertyValues): void;
      }
    ).update.call(this, changedProperties);
    const effectiveHeight = this.resolvedHeight;
    let container = this.renderRoot.querySelector<HTMLElement>('#chart-container');
    if (!container && typeof document !== 'undefined') {
      container = document.createElement('div');
      container.id = 'chart-container';
      container.className = 'vega-chart-container';
      this.renderRoot.appendChild(container);
    }
    if (container?.style) {
      container.style.height = `${effectiveHeight}px`;
      container.style.minHeight = `${effectiveHeight}px`;
    }
  }

  protected override firstUpdated() {
    this.observeContainer();
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.hasUpdated) {
      this.observeContainer();
    }
  }

  private observeContainer() {
    const container = this.renderRoot.querySelector<HTMLElement>('#chart-container');
    if (!container) return;

    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const {width, height} = entry.contentRect;
          if (width > 0 && height > 0) {
            const widthChanged = Math.round(width) !== this.containerWidth;
            this.containerWidth = Math.round(width);
            this.useFallbackWidth = false;
            if (!this.hasValidDimensions || widthChanged) {
              this.hasValidDimensions = true;
              void this.renderChart();
            }
          } else {
            this.hasValidDimensions = false;
          }
        }
      });
      this.resizeObserver.observe(container);
    }

    const scheduleFrame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0);

    const checkDimensions = (attempt = 0) => {
      if (!this.isConnected || this.hasValidDimensions) return;
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.containerWidth = Math.round(rect.width);
        this.useFallbackWidth = false;
        this.hasValidDimensions = true;
        void this.renderChart();
      } else if (attempt < 1) {
        scheduleFrame(() => {
          checkDimensions(attempt + 1);
        });
      } else if (rect.height > 0 && this.isAttachedButUnsized()) {
        // Container has height (from min-height / style) and is attached to a
        // visible tree (not inside `display: none`), yet still has width 0
        // after two rAFs because an ancestor shrinks to content. Fall back to a
        // finite width so the chart renders instead of staying blank forever.
        this.useFallbackWidth = true;
        this.hasValidDimensions = true;
        void this.renderChart();
      }
    };
    requestAnimationFrame(() => {
      checkDimensions(0);
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.hasValidDimensions = false;
    this.useFallbackWidth = false;
    this.destroyChart();
  }

  protected override updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    if (
      changedProperties.has('spec') ||
      changedProperties.has('height') ||
      changedProperties.has('embedFn') ||
      changedProperties.has('context') ||
      changedProperties.has('node') ||
      this.controller
    ) {
      if (this.hasValidDimensions) {
        void this.renderChart();
      }
    }
  }

  private destroyChart() {
    this.renderAbortController?.abort();
    this.renderAbortController = undefined;
    if (this.embedResult) {
      this.embedResult.finalize?.();
      this.embedResult.view?.finalize?.();
      this.embedResult = undefined;
    }
    const container = this.renderRoot?.querySelector<HTMLElement>('#chart-container');
    if (container) {
      container.replaceChildren();
    }
  }

  private async renderChart() {
    const vegaSpec = this.resolvedSpec;
    if (!vegaSpec) return;

    const container = this.renderRoot.querySelector<HTMLElement>('#chart-container');
    if (!container) return;

    this.destroyChart();
    const abortController = new AbortController();
    this.renderAbortController = abortController;

    try {
      const effectiveWidth =
        this.containerWidth > 0
          ? this.containerWidth
          : this.useFallbackWidth
            ? A2uiVegaChartElement.FALLBACK_WIDTH_PX
            : 0;
      const effectiveHeight = this.resolvedHeight;
      const facetSize = calculateFacetSize(vegaSpec, effectiveWidth);

      let containerHeight = effectiveHeight;
      if (facetSize) {
        containerHeight = Math.max(containerHeight, facetSize.totalEstimatedHeight);
      }

      const transformedSpec = transformSpec(vegaSpec, containerHeight, effectiveWidth, facetSize);

      if (this.useFallbackWidth) {
        this.style.width = `${effectiveWidth}px`;
      } else {
        this.style.width = '';
      }
      container.style.width = facetSize
        ? `${Math.max(effectiveWidth, facetSize.totalEstimatedWidth)}px`
        : this.useFallbackWidth
          ? `${effectiveWidth}px`
          : '100%';
      container.style.overflow = facetSize ? 'auto' : 'hidden';

      const activeEmbed = this.embedFn ?? A2uiVegaChartElement.defaultEmbedFn;
      const result = await activeEmbed(container, transformedSpec, {
        actions: false,
        renderer: 'svg',
      });

      if (abortController.signal.aborted) {
        result?.finalize?.();
        result?.view?.finalize?.();
        return;
      }
      this.embedResult = result;

      const iframe = container.querySelector('iframe');
      if (iframe) {
        iframe.style.height = `${containerHeight}px`;
        if (facetSize) {
          iframe.style.width = `${Math.max(effectiveWidth, facetSize.totalEstimatedWidth)}px`;
        } else {
          iframe.style.width = this.useFallbackWidth ? `${effectiveWidth}px` : '100%';
        }
        const a11yLabel = this.resolveAccessibleLabel(vegaSpec);
        if (!iframe.getAttribute('title')) {
          iframe.setAttribute('title', a11yLabel);
        }
        if (!iframe.getAttribute('aria-label')) {
          iframe.setAttribute('aria-label', a11yLabel);
        }
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        console.error('A2uiVegaChart Error:', e);
      }
    }
  }

  private resolveAccessibleLabel(vegaSpec: Record<string, unknown>): string {
    const a11y = (this.controller?.props as {accessibility?: {label?: string}} | undefined)
      ?.accessibility;
    if (typeof a11y?.label === 'string' && a11y.label.trim() !== '') {
      return a11y.label;
    }
    if (typeof vegaSpec['description'] === 'string' && vegaSpec['description'].trim() !== '') {
      return vegaSpec['description'];
    }
    if (typeof vegaSpec['title'] === 'string' && vegaSpec['title'].trim() !== '') {
      return vegaSpec['title'];
    }
    if (
      isPlainObject(vegaSpec['title']) &&
      typeof vegaSpec['title']['text'] === 'string' &&
      vegaSpec['title']['text'].trim() !== ''
    ) {
      return vegaSpec['title']['text'];
    }
    return 'Vega visualization';
  }

  /**
   * Returns true if the element is attached to the layout tree (not inside a
   * `display: none` subtree), even if its width is currently 0 due to an
   * intrinsically-sized flex/grid ancestor.
   */
  private isAttachedButUnsized(): boolean {
    if (!this.isConnected) return false;
    return this.offsetParent !== null || this.getClientRects().length > 0;
  }

  override render() {
    const effectiveHeight = this.resolvedHeight;
    return html`
      <div
        id="chart-container"
        class="vega-chart-container"
        style="height: ${effectiveHeight}px; min-height: ${effectiveHeight}px;"
      ></div>
    `;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(A2uiVegaChartElement.tagName)) {
  customElements.define(A2uiVegaChartElement.tagName, A2uiVegaChartElement);
}

/**
 * Universal WebComponentImplementation for `VegaChart` (protocol v0.9).
 */
export const A2uiVegaChart: WebComponentImplementation = {
  ...VegaChartApi,
  tagName: A2uiVegaChartElement.tagName,
  element: A2uiVegaChartElement,
};

/**
 * Universal WebComponentImplementation for `VegaChart` (protocol v1.0).
 */
export const A2uiVegaChartV1: WebComponentImplementation = {
  ...VegaChartV1Api,
  tagName: A2uiVegaChartElement.tagName,
  element: A2uiVegaChartElement,
};

/** Options for creating a VegaChart catalog instance. */
export interface VegaChartCatalogOptions {
  /**
   * Optional custom Vega embed function to set as the default embedder on
   * `A2uiVegaChartElement.defaultEmbedFn`. Note that this updates the static
   * default across all `<a2ui-vega-chart>` elements that do not specify an
   * instance-level `embedFn` property.
   */
  embedFn?: VegaEmbedFn;
  /**
   * Additional functions to register alongside the VegaChart component.
   */
  functions?: FunctionImplementation[];
}

/**
 * Creates an A2UI v0.9 `Catalog` containing the `VegaChart` web component.
 */
export function createVegaChartCatalog(
  options?: VegaChartCatalogOptions,
): Catalog<WebComponentImplementation> {
  if (options?.embedFn) {
    A2uiVegaChartElement.defaultEmbedFn = options.embedFn;
  }
  return new Catalog<WebComponentImplementation>(
    VEGACHART_CATALOG_ID,
    '0.9',
    [A2uiVegaChart],
    options?.functions ?? [],
    {
      schemaUri: 'https://json-schema.org/draft/2020-12/schema',
      schemaId: VEGACHART_CATALOG_ID,
      declaredProtocolVersion: null,
      title: 'A2UI VegaChart Catalog',
      description:
        'Catalog for rendering Vega and Vega-Lite charts in A2UI surfaces. Includes the VegaChart component for displaying interactive data visualizations from Vega-Lite JSON specifications.',
      commonTypesUri: 'https://a2ui.org/specification/v0_9/common_types.json',
      unions: {anyComponent: true, anyFunction: true},
    },
  );
}

/**
 * Creates an A2UI v1.0 `Catalog` containing the `VegaChart` web component.
 */
export function createVegaChartV1Catalog(
  options?: VegaChartCatalogOptions,
): Catalog<WebComponentImplementation> {
  if (options?.embedFn) {
    A2uiVegaChartElement.defaultEmbedFn = options.embedFn;
  }
  return new Catalog<WebComponentImplementation>(
    VEGACHART_V1_CATALOG_ID,
    '1.0',
    [A2uiVegaChartV1],
    options?.functions ?? [],
    {
      schemaUri: 'https://json-schema.org/draft/2020-12/schema',
      schemaId: VEGACHART_V1_CATALOG_ID,
      title: 'A2UI VegaChart Catalog',
      description:
        'Catalog for rendering Vega and Vega-Lite charts in A2UI surfaces. Declares the VegaChart component for displaying interactive data visualizations from Vega-Lite JSON specifications.',
    },
  );
}

/** Default A2UI v0.9 VegaChart catalog instance. */
export const vegachartCatalog: Catalog<WebComponentImplementation> = createVegaChartCatalog();

/** Default A2UI v1.0 VegaChart catalog instance. */
export const vegachartV1Catalog: Catalog<WebComponentImplementation> = createVegaChartV1Catalog();

declare global {
  interface HTMLElementTagNameMap {
    'a2ui-vega-chart': A2uiVegaChartElement;
  }
}
