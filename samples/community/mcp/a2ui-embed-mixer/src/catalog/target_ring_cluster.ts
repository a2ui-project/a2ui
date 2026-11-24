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

/**
 * `TargetRingCluster`: Animated multi-ring concentric SVG radial gauges + metric cards
 * bound to `@call: computeMixTotals(/items, /targets)` that turn emerald green when each
 * metric hits its target band.
 */

import {css, html, nothing, svg} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
  type ComponentApi,
} from '@a2ui/web_core/v1_0';

import type {ComputedMetric} from './functions.js';

const RING_RADII = [39, 31, 23, 15] as const;

export const TargetRingClusterApi = {
  name: 'TargetRingCluster',
  schema: spec(
    z
      .object({
        totals: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Result of @call computeMixTotals(/items, /targets).',
        ),
        layout: z
          .enum(['strip', 'compact'])
          .describe('Layout mode: strip (full-width row) or compact (2x2 grid card).')
          .optional(),
        caption: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional caption above the metric gauges.',
        ).optional(),
      })
      .describe(
        'Animated concentric multi-ring SVG radial gauges that turn green as each metric enters its target band.',
      )
      .strict(),
    {mixins: [], required: ['totals']},
  ),
} satisfies ComponentApi;

function parseMetrics(raw: unknown): ComputedMetric[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const list = (raw as Record<string, unknown>)['metrics'];
  if (!Array.isArray(list)) return [];
  return list.filter(
    (entry): entry is ComputedMetric =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}

/**
 * @cssprop [--a2ui-target-rings-bg=var(--color-background-secondary)] - Cluster panel background.
 * @cssprop [--a2ui-target-rings-hit=light-dark(#188038, #5bb974)] - Ring and badge color when target hit.
 * @cssprop [--a2ui-target-rings-miss=light-dark(#e37400, #fdd663)] - Ring and badge color when outside band.
 */
export class A2uiTargetRingClusterElement extends A2uiLitElement<typeof TargetRingClusterApi> {
  static readonly tagName = 'a2ui-target-ring-cluster';

  static override styles = css`
    :host {
      display: block;
    }
    .ring-cluster {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(
        --a2ui-target-rings-bg,
        var(--color-background-secondary, light-dark(#f6f8fc, #28292a))
      );
      border: 1px solid var(--color-border-primary, light-dark(#e0e3e7, #3c4043));
    }
    .ring-cluster[data-layout='compact'] {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      height: 100%;
      box-sizing: border-box;
    }
    .ring-cluster__top {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .ring-cluster__dial {
      flex: none;
      width: 84px;
      height: 84px;
      position: relative;
    }
    .ring-cluster[data-layout='compact'] .ring-cluster__dial {
      width: 68px;
      height: 68px;
    }
    .ring-cluster__svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .ring-cluster__track {
      fill: none;
      stroke: var(--color-border-primary, light-dark(#dce1e8, #3d4146));
      stroke-width: 5.2;
    }
    .ring-cluster__arc {
      fill: none;
      stroke-width: 5.2;
      stroke-linecap: round;
      transform: rotate(-90deg);
      transform-origin: 46px 46px;
      transition:
        stroke-dashoffset 220ms cubic-bezier(0.22, 1, 0.36, 1),
        stroke 180ms ease;
    }
    .ring-cluster__arc[data-hit='true'] {
      stroke: var(--a2ui-target-rings-hit, light-dark(#188038, #5bb974));
    }
    .ring-cluster__arc[data-hit='false'] {
      stroke: var(--a2ui-target-rings-miss, light-dark(#e37400, #fdd663));
    }
    .ring-cluster__center {
      font-size: 11px;
      font-weight: 700;
      fill: var(--color-text-primary, light-dark(#1f1f1f, #e3e3e3));
      text-anchor: middle;
      dominant-baseline: central;
    }
    .ring-cluster__caption {
      font-size: 11px;
      font-weight: 600;
      color: var(--color-text-secondary, light-dark(#5f6368, #a8abb0));
    }
    .ring-cluster__cards {
      flex: 1;
      min-width: 0;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
    }
    .ring-cluster[data-layout='compact'] .ring-cluster__cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    @media (max-width: 560px) {
      .ring-cluster__cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .ring-cluster__card {
      padding: 6px 8px;
      border-radius: 8px;
      background: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      border: 1px solid var(--color-border-primary, light-dark(#e2e6ec, #3c4043));
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition:
        border-color 180ms ease,
        background-color 180ms ease;
    }
    .ring-cluster__card[data-hit='true'] {
      border-color: light-dark(#a8dab5, #2e6b40);
      background: light-dark(#f4fbf6, #1b2820);
    }
    .ring-cluster__card[data-hit='false'] {
      border-color: light-dark(#f7cb77, #6b531c);
      background: light-dark(#fffcf2, #2b2519);
    }
    .ring-cluster__card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
    }
    .ring-cluster__label {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--color-text-secondary, light-dark(#5f6368, #a8abb0));
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ring-cluster__state {
      font-size: 10px;
      font-weight: 700;
      padding: 0 4px;
      border-radius: 4px;
    }
    .ring-cluster__card[data-hit='true'] .ring-cluster__state {
      color: light-dark(#137333, #81c995);
      background: light-dark(#e6f4ea, #22432c);
    }
    .ring-cluster__card[data-hit='false'] .ring-cluster__state {
      color: light-dark(#b06000, #fdd663);
      background: light-dark(#fef7e0, #463614);
    }
    .ring-cluster__value {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.2;
      color: var(--color-text-primary, light-dark(#1f1f1f, #e3e3e3));
      font-variant-numeric: tabular-nums;
    }
    .ring-cluster__meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
      font-size: 10px;
      color: var(--color-text-secondary, light-dark(#5f6368, #a8abb0));
      font-variant-numeric: tabular-nums;
    }
  `;

  protected override readonly api = TargetRingClusterApi;

  private renderConcentricSvg(metrics: readonly ComputedMetric[], hits: number) {
    const visible = metrics.slice(0, 4);
    return html`
      <div class="ring-cluster__dial" aria-hidden="true">
        <svg class="ring-cluster__svg" viewBox="0 0 92 92">
          ${visible.map((metric, idx) => {
            const radius = RING_RADII[idx] ?? 15;
            const circumference = 2 * Math.PI * radius;
            const clampedRatio = Math.min(1, Math.max(0.06, metric.ratio ?? 0.5));
            const offset = circumference * (1 - clampedRatio);
            return svg`
              <circle class="ring-cluster__track" cx="46" cy="46" r=${radius} />
              <circle
                class="ring-cluster__arc"
                cx="46"
                cy="46"
                r=${radius}
                data-hit=${metric.hit ? 'true' : 'false'}
                stroke-dasharray=${circumference.toFixed(2)}
                stroke-dashoffset=${offset.toFixed(2)}
              />
            `;
          })}
          <text class="ring-cluster__center" x="46" y="46">${hits}/${visible.length}</text>
        </svg>
      </div>
    `;
  }

  private renderMetricCard(metric: ComputedMetric) {
    return html`
      <div
        class="ring-cluster__card"
        data-metric-key=${metric.key}
        data-hit=${metric.hit ? 'true' : 'false'}
      >
        <div class="ring-cluster__card-head">
          <span class="ring-cluster__label">${metric.label}</span>
          <span class="ring-cluster__state">${metric.hit ? 'HIT' : 'ADJ'}</span>
        </div>
        <div class="ring-cluster__value">${metric.formatted}</div>
        <div class="ring-cluster__meta">
          <span>Goal ${metric.targetLabel}</span>
          <span>${metric.deltaLabel}</span>
        </div>
      </div>
    `;
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const rawTotals = props['totals'];
    const metrics = parseMetrics(rawTotals);
    const hits =
      rawTotals && typeof rawTotals === 'object' && !Array.isArray(rawTotals)
        ? Number((rawTotals as Record<string, unknown>)['hits'] ?? 0)
        : 0;
    const layout = props['layout'] === 'compact' ? 'compact' : 'strip';
    const caption = typeof props['caption'] === 'string' ? props['caption'] : '';

    if (layout === 'compact') {
      return html`
        <div
          class="ring-cluster"
          data-layout="compact"
          role="group"
          aria-label="Goal target gauges"
        >
          <div class="ring-cluster__top">
            ${this.renderConcentricSvg(metrics, hits)}
            <div class="ring-cluster__caption">
              ${caption || 'Live multi-goal target rings (green = inside target band)'}
            </div>
          </div>
          <div class="ring-cluster__cards">${metrics.map(m => this.renderMetricCard(m))}</div>
        </div>
      `;
    }

    return html`
      <div class="ring-cluster" data-layout="strip" role="group" aria-label="Goal target gauges">
        ${this.renderConcentricSvg(metrics, hits)}
        <div class="ring-cluster__cards">${metrics.map(m => this.renderMetricCard(m))}</div>
      </div>
    `;
  }
}

export const A2uiTargetRingCluster = {
  ...TargetRingClusterApi,
  tagName: A2uiTargetRingClusterElement.tagName,
  element: A2uiTargetRingClusterElement,
};
