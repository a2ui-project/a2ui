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

// tslint:disable:no-new-decorators
import {css, html, LitElement, type PropertyValues} from 'lit';
import {property} from 'lit/decorators.js';

import {A2uiLitElement} from '@a2ui/web_core/v1_0';

import type {VegaChartApi} from '../v0_9/index.js';
import type {VegaChartV1Api} from '../v1/index.js';

/** Default chart height in pixels when `height` is not specified. */
export const DEFAULT_HEIGHT = 290;

/**
 * Width in pixels used when the container reports `width: 0` on two
 * consecutive animation frames, for example inside an intrinsically sized flex
 * item. The `ResizeObserver` re-renders at the measured width once the
 * container gets one.
 */
export const FALLBACK_WIDTH_PX = 400;

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
 * Renders a Vega or Vega-Lite specification into a DOM element. `vega-embed`
 * has this signature; a sandboxed renderer or a test double can replace it.
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
  const mod = (await import('vega-embed')) as unknown as {
    default?: VegaEmbedFn;
    embed?: VegaEmbedFn;
  };
  const embedFn = mod.default ?? mod.embed ?? (mod as unknown as VegaEmbedFn);
  return embedFn(el, chartSpec, options);
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Returns the inline data of a Vega-Lite spec: `data.values`, or
 * `datasets[data.name]` when `data.name` is set.
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
 * Returns the largest number of distinct values of `fieldObj.field` within a
 * single facet, used to size faceted subplots by their content.
 */
function estimateNumValuesInFacet(
  data: Array<Record<string, unknown>>,
  fieldObj: Record<string, unknown>,
  facetFieldName: string | undefined,
): number {
  const fieldName = fieldObj['field'];
  if (typeof fieldName !== 'string') return 0;

  if (!facetFieldName) {
    return new Set(data.map(d => d[fieldName])).size;
  }

  const facetGroups = new Map<unknown, Set<unknown>>();
  for (const row of data) {
    const facetVal = row[facetFieldName];
    let group = facetGroups.get(facetVal);
    if (!group) {
      group = new Set();
      facetGroups.set(facetVal, group);
    }
    group.add(row[fieldName]);
  }

  let maxUnique = 0;
  for (const uniqueSet of facetGroups.values()) {
    maxUnique = Math.max(maxUnique, uniqueSet.size);
  }
  return maxUnique;
}

/** Layout computed for a faceted chart. */
export interface FacetSize {
  /** Width of each subplot in pixels. */
  width: number;
  /** Height of each subplot in pixels. */
  height: number;
  /** Estimated total chart width in pixels, including axes and padding. */
  totalEstimatedWidth: number;
  /** Estimated total chart height in pixels, including headers and padding. */
  totalEstimatedHeight: number;
}

/**
 * Computes subplot dimensions for a faceted Vega-Lite chart, or returns `null`
 * when the spec is not faceted. In Vega-Lite, `width` and `height` on a
 * faceted spec apply to each subplot, not to the whole chart.
 */
export function calculateFacetSize(
  vegaSpec: Record<string, unknown>,
  containerWidth: number,
): FacetSize | null {
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
      if (isPlainObject(facet['row']) && !facetFieldName) {
        facetFieldName =
          typeof facet['row']['field'] === 'string' ? facet['row']['field'] : undefined;
        columns = 1;
      }
    }
  }

  if (!isFaceted) {
    return null;
  }

  const data = getDataValues(vegaSpec);

  let numFacets = 1;
  if (facetFieldName && data.length > 0) {
    numFacets = Math.max(1, new Set(data.map(d => d[facetFieldName])).size);
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

  return {
    width,
    height,
    totalEstimatedWidth: effectiveCols * (width + 60) + 40,
    totalEstimatedHeight: rows * (height + 80) + 60,
  };
}

/**
 * Rewrites temporal axes whose `format` contains `%b` (month name) but no
 * `%Y` (year) to `%b %Y` with a -45 degree label angle, so month labels
 * spanning several years are not ambiguous. Recurses into `layer` and `spec`.
 */
function fixTemporalAxes(specObj: Record<string, unknown>) {
  const encoding = specObj['encoding'];
  if (isPlainObject(encoding)) {
    for (const channel of ['x', 'y']) {
      const channelDef = encoding[channel];
      if (!isPlainObject(channelDef)) continue;
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
}

/**
 * Returns a copy of `vegaSpec` prepared for responsive rendering:
 *
 * - Merges `DEFAULT_CHART_CONFIG` under any user-defined `config`.
 * - Sets `autosize` to `fit` for standard charts and `pad` for faceted charts.
 * - Sets `width` and `height` from the container for standard charts, or
 *   per-subplot dimensions from `calculateFacetSize` for faceted charts.
 * - Applies `fixTemporalAxes`.
 *
 * @param vegaSpec The raw Vega-Lite specification.
 * @param containerHeight Target chart height in pixels.
 * @param containerWidth Measured container width in pixels, or 0 if unknown.
 * @param precomputedFacetSize Facet layout, if the caller already computed it.
 */
export function transformSpec(
  vegaSpec: Record<string, unknown>,
  containerHeight: number = DEFAULT_HEIGHT,
  containerWidth = 0,
  precomputedFacetSize?: FacetSize | null,
): Record<string, unknown> {
  const transformedSpec = structuredClone(vegaSpec);

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
    axis: {...DEFAULT_CHART_CONFIG.axis, ...existingAxis},
    view: {...DEFAULT_CHART_CONFIG.view, ...existingView},
  };

  transformedSpec['autosize'] = facetSize ? {type: 'pad'} : {type: 'fit', contains: 'padding'};

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
 * `<a2ui-vega-chart>`: renders a Vega or Vega-Lite specification.
 *
 * The element serves both the v0.9 and v1.0 catalogs. Inside an A2UI surface
 * it reads `spec` and `height` from its controller. Outside a
 * surface it reads the `spec` and `height` properties directly.
 */
export class A2uiVegaChartElement extends A2uiLitElement<
  typeof VegaChartApi | typeof VegaChartV1Api
> {
  static readonly tagName = 'a2ui-vega-chart';

  /**
   * Embed function used when an element does not set its own `embedFn`.
   * Defaults to dynamically importing `vega-embed`.
   */
  static defaultEmbedFn: VegaEmbedFn = defaultVegaEmbed;

  /** Vega-Lite spec for standalone use; `controller.props.spec` takes precedence. */
  @property({attribute: false}) spec?: Record<string, unknown> | null;

  /** Height in pixels for standalone use; `controller.props.height` takes precedence. */
  @property({attribute: false}) height: number | null = DEFAULT_HEIGHT;

  /** Per-element embed function override. */
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
  private hostWidthApplied = false;
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

  private get chartContainer(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('#chart-container');
  }

  /** Renders into the light DOM, like the basic catalog, so page styles reach the chart. */
  override createRenderRoot() {
    return this;
  }

  /**
   * `A2uiLitElement.update` skips rendering without a controller. Standalone
   * use has no controller, so render once a `spec` property is set, and keep
   * rendering afterwards so clearing `spec` removes the chart.
   */
  protected override update(changedProperties: PropertyValues) {
    if (this.controller) {
      super.update(changedProperties);
    } else if (this.spec !== undefined || this.hasUpdated) {
      (LitElement.prototype as unknown as {update(p: PropertyValues): void}).update.call(
        this,
        changedProperties,
      );
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

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.hasValidDimensions = false;
    this.useFallbackWidth = false;
    this.destroyChart();
  }

  protected override updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    if (this.hasValidDimensions) {
      void this.renderChart();
    }
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

  /**
   * Renders once the container has a measurable size, then re-renders on
   * width changes. If the container stays at width 0 for two animation frames
   * while attached to a visible tree, renders at `FALLBACK_WIDTH_PX`.
   */
  private observeContainer() {
    const container = this.chartContainer;
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

    const checkDimensions = (attempt: number) => {
      if (!this.isConnected || this.hasValidDimensions) return;
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.containerWidth = Math.round(rect.width);
        this.useFallbackWidth = false;
        this.hasValidDimensions = true;
        void this.renderChart();
      } else if (attempt < 1) {
        requestAnimationFrame(() => checkDimensions(attempt + 1));
      } else if (rect.height > 0 && this.isAttachedButUnsized()) {
        this.useFallbackWidth = true;
        this.hasValidDimensions = true;
        void this.renderChart();
      }
    };
    requestAnimationFrame(() => checkDimensions(0));
  }

  /** True when attached to the layout tree (not inside `display: none`). */
  private isAttachedButUnsized(): boolean {
    if (!this.isConnected) return false;
    return this.offsetParent !== null || this.getClientRects().length > 0;
  }

  /**
   * Aborts any in-flight embed, finalizes the current view, and empties the
   * container. A late-resolving embed writes into its own detached wrapper
   * (see `renderChart`), so it cannot reappear here.
   */
  private destroyChart() {
    this.renderAbortController?.abort();
    this.renderAbortController = undefined;
    this.embedResult?.finalize?.();
    this.embedResult?.view?.finalize?.();
    this.embedResult = undefined;
    this.chartContainer?.replaceChildren();
  }

  /** Sets or clears the host width without touching a consumer's inline width. */
  private applyHostWidth(widthPx: number | null) {
    if (widthPx !== null) {
      this.style.width = `${widthPx}px`;
      this.hostWidthApplied = true;
    } else if (this.hostWidthApplied) {
      this.style.removeProperty('width');
      this.hostWidthApplied = false;
    }
  }

  private async renderChart() {
    this.destroyChart();
    const vegaSpec = this.resolvedSpec;
    const container = this.chartContainer;
    if (!vegaSpec || !container) return;

    const abortController = new AbortController();
    this.renderAbortController = abortController;

    try {
      const effectiveWidth =
        this.containerWidth > 0
          ? this.containerWidth
          : this.useFallbackWidth
            ? FALLBACK_WIDTH_PX
            : 0;
      const facetSize = calculateFacetSize(vegaSpec, effectiveWidth);
      const containerHeight = facetSize
        ? Math.max(this.resolvedHeight, facetSize.totalEstimatedHeight)
        : this.resolvedHeight;
      const transformedSpec = transformSpec(vegaSpec, containerHeight, effectiveWidth, facetSize);

      this.applyHostWidth(this.useFallbackWidth ? effectiveWidth : null);
      container.style.width = this.useFallbackWidth ? `${effectiveWidth}px` : '100%';
      // Faceted charts grow to fit every subplot and start-align so a wide
      // grid can scroll into view; standard charts fill the requested height.
      container.style.height = facetSize ? 'auto' : `${containerHeight}px`;
      container.style.minHeight = `${containerHeight}px`;
      container.style.overflowX = facetSize ? 'auto' : 'hidden';
      container.style.overflowY = 'hidden';
      container.style.justifyContent = facetSize ? 'flex-start' : '';
      container.style.alignItems = facetSize ? 'flex-start' : '';

      // Embed into a per-render wrapper. If this render is superseded,
      // `destroyChart` detaches the wrapper and the embed finishes offscreen.
      const wrapper = document.createElement('div');
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';
      container.appendChild(wrapper);

      const embed = this.embedFn ?? A2uiVegaChartElement.defaultEmbedFn;
      const result = await embed(wrapper, transformedSpec, {actions: false, renderer: 'svg'});

      if (abortController.signal.aborted) {
        result?.finalize?.();
        result?.view?.finalize?.();
        return;
      }
      this.embedResult = result;

      // Sandboxed embedders render into an iframe; size and label it.
      const iframe = wrapper.querySelector('iframe');
      if (iframe) {
        iframe.style.height = `${containerHeight}px`;
        iframe.style.width = this.useFallbackWidth ? `${effectiveWidth}px` : '100%';
        const label = this.resolveAccessibleLabel(vegaSpec);
        if (!iframe.getAttribute('title')) iframe.setAttribute('title', label);
        if (!iframe.getAttribute('aria-label')) iframe.setAttribute('aria-label', label);
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
    for (const candidate of [vegaSpec['description'], vegaSpec['title']]) {
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        return candidate;
      }
      if (
        isPlainObject(candidate) &&
        typeof candidate['text'] === 'string' &&
        candidate['text'].trim() !== ''
      ) {
        return candidate['text'];
      }
    }
    return 'Vega visualization';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'a2ui-vega-chart': A2uiVegaChartElement;
  }
}
