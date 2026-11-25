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
 * `ParetoPlane2D`: Interactive 2D SVG trade-off frontier plot (e.g., Weekly Cost vs Weekday
 * Prep Mins, or Months to Debt-Free vs Monthly Cushion) plotting Pareto-optimal presets and
 * the live "Current mix" crosshair. Clicking any frontier preset dot or chip updates `/items`
 * client-side with zero server round-trips.
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

import type {ParetoPreset} from './functions.js';

const SVG_W = 320;
const SVG_H = 116;
const PAD_L = 44;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 20;
const PLOT_W = SVG_W - PAD_L - PAD_R;
const PLOT_H = SVG_H - PAD_T - PAD_B;

const SweetSpotSchema = spec(
  z
    .object({
      xMin: z.number(),
      xMax: z.number(),
      yMin: z.number(),
      yMax: z.number(),
    })
    .strict(),
  {closure: 'additionalProperties'},
);

export const ParetoPlane2DApi = {
  name: 'ParetoPlane2D',
  schema: spec(
    z
      .object({
        title: DynamicStringSchema.describe('REF:#/$defs/DynamicString|Frontier chart title.'),
        xKey: z.string().describe('Metric key in computeMixTotals.valuesByKey for X axis.'),
        yKey: z.string().describe('Metric key in computeMixTotals.valuesByKey for Y axis.'),
        xLabel: DynamicStringSchema.describe('REF:#/$defs/DynamicString|X-axis label.'),
        yLabel: DynamicStringSchema.describe('REF:#/$defs/DynamicString|Y-axis label.'),
        xDomain: z.array(z.number()).min(2).max(2).describe('[min, max] domain for X axis.'),
        yDomain: z.array(z.number()).min(2).max(2).describe('[min, max] domain for Y axis.'),
        sweetSpot: SweetSpotSchema.describe(
          'Optional shaded target band rectangle in (x, y) data coordinates.',
        ).optional(),
        wide: z
          .boolean()
          .describe('True when rendered full-width as a hero Pareto stage.')
          .optional(),
        presets: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Array of Pareto-optimal presets plotted along the frontier.',
        ),
        items: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Bound to /items so clicking a preset dot updates /items live.',
        ),
        selectedPresetId: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Bound to /selectedPresetId.',
        ).optional(),
        totals: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Live computeMixTotals(/items, /targets) driving the Current mix crosshair.',
        ),
      })
      .describe(
        'Interactive 2D SVG Pareto trade-off frontier plot with live Current mix crosshair.',
      )
      .strict(),
    {
      mixins: [],
      required: [
        'title',
        'xKey',
        'yKey',
        'xLabel',
        'yLabel',
        'xDomain',
        'yDomain',
        'presets',
        'items',
        'totals',
      ],
    },
  ),
} satisfies ComponentApi;

interface WritableParetoProps {
  setItems?: (next: unknown) => void;
  setSelectedPresetId?: (next: string) => void;
}

function projectX(val: number, domain: readonly [number, number], plotW = PLOT_W): number {
  const span = domain[1] - domain[0] || 1;
  const t = Math.min(1, Math.max(0, (val - domain[0]) / span));
  return PAD_L + t * plotW;
}

function projectY(val: number, domain: readonly [number, number]): number {
  const span = domain[1] - domain[0] || 1;
  const t = Math.min(1, Math.max(0, (val - domain[0]) / span));
  return PAD_T + (1 - t) * PLOT_H;
}

function parsePresets(raw: unknown): ParetoPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is ParetoPreset =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}

/**
 * @cssprop [--a2ui-pareto-bg=var(--color-background-secondary)] - Frontier card background.
 * @cssprop [--a2ui-pareto-accent=var(--color-ring-primary)] - Frontier node and curve color.
 */
export class A2uiParetoPlane2DElement extends A2uiLitElement<typeof ParetoPlane2DApi> {
  static readonly tagName = 'a2ui-pareto-plane-2d';

  static override styles = css`
    :host {
      display: block;
    }
    .pareto-plane {
      box-sizing: border-box;
      height: 100%;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(
        --a2ui-pareto-bg,
        var(--color-background-secondary, light-dark(#f6f8fc, #28292a))
      );
      border: 1px solid var(--color-border-primary, light-dark(#e0e3e7, #3c4043));
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .pareto-plane__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .pareto-plane__title {
      font-size: 11px;
      font-weight: 700;
      color: var(--color-text-primary, light-dark(#1f1f1f, #e3e3e3));
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pareto-plane__hint {
      flex: none;
      font-size: 9.5px;
      color: var(--color-text-secondary, light-dark(#5f6368, #a8abb0));
      white-space: nowrap;
    }
    .pareto-plane__svg {
      width: 100%;
      height: auto;
      max-height: 132px;
      display: block;
      background: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      border-radius: 7px;
      border: 1px solid var(--color-border-primary, light-dark(#e6e9ef, #36393d));
    }
    .pareto-plane__sweetspot {
      fill: light-dark(rgba(24, 128, 56, 0.11), rgba(91, 185, 116, 0.15));
      stroke: light-dark(rgba(24, 128, 56, 0.35), rgba(91, 185, 116, 0.4));
      stroke-width: 1;
      stroke-dasharray: 3 2;
    }
    .pareto-plane__grid {
      stroke: var(--color-border-primary, light-dark(#eceff4, #303338));
      stroke-width: 1;
    }
    .pareto-plane__axis-label {
      font-size: 8.5px;
      fill: var(--color-text-secondary, light-dark(#5f6368, #a8abb0));
    }
    .pareto-plane__frontier {
      fill: none;
      stroke: var(--a2ui-pareto-accent, var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8)));
      stroke-width: 1.6;
      stroke-dasharray: 4 3;
      opacity: 0.75;
    }
    .pareto-plane__node {
      cursor: pointer;
    }
    .pareto-plane__node-dot {
      fill: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      stroke: var(--a2ui-pareto-accent, var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8)));
      stroke-width: 2;
      transition: r 140ms ease;
    }
    .pareto-plane__node[data-selected='true'] .pareto-plane__node-dot {
      fill: var(--a2ui-pareto-accent, var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8)));
    }
    .pareto-plane__node-label {
      font-size: 8px;
      font-weight: 600;
      fill: var(--color-text-secondary, light-dark(#444746, #c4c7c5));
      pointer-events: none;
    }
    .pareto-plane__crosshair-line {
      stroke: light-dark(#188038, #81c995);
      stroke-width: 1.1;
      stroke-dasharray: 2 2;
      opacity: 0.85;
      pointer-events: none;
    }
    .pareto-plane__crosshair-ring {
      fill: light-dark(rgba(24, 128, 56, 0.18), rgba(129, 201, 149, 0.22));
      stroke: light-dark(#137333, #81c995);
      stroke-width: 1.8;
      pointer-events: none;
    }
    .pareto-plane__crosshair-core {
      fill: light-dark(#137333, #81c995);
      pointer-events: none;
    }
    .pareto-plane__crosshair-tag {
      font-size: 8.5px;
      font-weight: 700;
      fill: light-dark(#137333, #81c995);
      pointer-events: none;
    }
    .pareto-plane__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
    }
    .pareto-plane__chip {
      padding: 1.5px 5.5px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--color-border-primary, light-dark(#d4d8de, #444746));
      background: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      color: var(--color-text-secondary, light-dark(#474b50, #b8bcc2));
    }
    .pareto-plane__chip[data-selected='true'] {
      border-color: var(
        --a2ui-pareto-accent,
        var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8))
      );
      color: var(--a2ui-pareto-accent, var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8)));
      background: light-dark(#eef4fe, #222c3c);
    }
  `;

  protected override readonly api = ParetoPlane2DApi;

  private applyPreset(preset: ParetoPreset): void {
    const props = this.controller?.props;
    if (!props) return;
    const rawItems = props['items'];
    if (!Array.isArray(rawItems)) return;

    const nextItems = rawItems.map(entry => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry;
      const record = entry as Record<string, unknown>;
      const id = typeof record['id'] === 'string' ? record['id'] : '';
      const assignment = preset.mix[id];
      if (!assignment) return entry;
      return {
        ...record,
        scale: assignment.scale,
        activeOptionId: assignment.activeOptionId,
      };
    });

    const writable = props as unknown as WritableParetoProps;
    writable.setItems?.(nextItems);
    writable.setSelectedPresetId?.(preset.id);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const title = typeof props['title'] === 'string' ? props['title'] : 'Trade-off frontier';
    const xKey = typeof props['xKey'] === 'string' ? props['xKey'] : '';
    const yKey = typeof props['yKey'] === 'string' ? props['yKey'] : '';
    const xLabel = typeof props['xLabel'] === 'string' ? props['xLabel'] : xKey;
    const yLabel = typeof props['yLabel'] === 'string' ? props['yLabel'] : yKey;
    const rawXDomain = Array.isArray(props['xDomain']) ? props['xDomain'] : [0, 100];
    const rawYDomain = Array.isArray(props['yDomain']) ? props['yDomain'] : [0, 100];
    const xDomain: readonly [number, number] = [
      Number(rawXDomain[0] ?? 0),
      Number(rawXDomain[1] ?? 100),
    ];
    const yDomain: readonly [number, number] = [
      Number(rawYDomain[0] ?? 0),
      Number(rawYDomain[1] ?? 100),
    ];

    const isWide = Boolean(props['wide']);
    const svgW = isWide ? 620 : SVG_W;
    const plotW = svgW - PAD_L - PAD_R;

    const presets = parsePresets(props['presets']);
    const sortedPresets = [...presets].sort((a, b) => a.x - b.x);
    const polylinePoints = sortedPresets
      .map(p => `${projectX(p.x, xDomain, plotW).toFixed(1)},${projectY(p.y, yDomain).toFixed(1)}`)
      .join(' ');

    const rawTotals =
      props['totals'] && typeof props['totals'] === 'object' && !Array.isArray(props['totals'])
        ? (props['totals'] as Record<string, unknown>)
        : undefined;
    const valuesByKey =
      rawTotals && typeof rawTotals['valuesByKey'] === 'object' && rawTotals['valuesByKey'] !== null
        ? (rawTotals['valuesByKey'] as Record<string, unknown>)
        : {};
    const liveXVal =
      typeof valuesByKey[xKey] === 'number' ? (valuesByKey[xKey] as number) : xDomain[0];
    const liveYVal =
      typeof valuesByKey[yKey] === 'number' ? (valuesByKey[yKey] as number) : yDomain[0];
    const cx = projectX(liveXVal, xDomain, plotW);
    const cy = projectY(liveYVal, yDomain);
    const tagX = cx > svgW - 92 ? cx - 7 : cx + 7;
    const tagAnchor = cx > svgW - 92 ? 'end' : 'start';
    const tagY = cy > SVG_H - PAD_B - 14 ? cy - 8 : cy + 12;

    const selectedPresetId =
      typeof props['selectedPresetId'] === 'string' ? props['selectedPresetId'] : '';
    const sweet =
      props['sweetSpot'] && typeof props['sweetSpot'] === 'object'
        ? (props['sweetSpot'] as {xMin: number; xMax: number; yMin: number; yMax: number})
        : undefined;

    const sweetRect = sweet
      ? {
          x: Math.min(projectX(sweet.xMin, xDomain, plotW), projectX(sweet.xMax, xDomain, plotW)),
          y: Math.min(projectY(sweet.yMin, yDomain), projectY(sweet.yMax, yDomain)),
          w: Math.abs(projectX(sweet.xMax, xDomain, plotW) - projectX(sweet.xMin, xDomain, plotW)),
          h: Math.abs(projectY(sweet.yMax, yDomain) - projectY(sweet.yMin, yDomain)),
        }
      : undefined;

    return html`
      <div class="pareto-plane" role="group" aria-label=${title}>
        <div class="pareto-plane__head">
          <span class="pareto-plane__title">${title}</span>
          <span class="pareto-plane__hint">Click dot</span>
        </div>

        <svg class="pareto-plane__svg" viewBox=${`0 0 ${svgW} ${SVG_H}`}>
          <line
            class="pareto-plane__grid"
            x1=${PAD_L}
            y1=${PAD_T + PLOT_H / 2}
            x2=${svgW - PAD_R}
            y2=${PAD_T + PLOT_H / 2}
          />
          <line
            class="pareto-plane__grid"
            x1=${PAD_L + plotW / 2}
            y1=${PAD_T}
            x2=${PAD_L + plotW / 2}
            y2=${SVG_H - PAD_B}
          />
          <line
            class="pareto-plane__grid"
            x1=${PAD_L}
            y1=${SVG_H - PAD_B}
            x2=${svgW - PAD_R}
            y2=${SVG_H - PAD_B}
          />
          <line
            class="pareto-plane__grid"
            x1=${PAD_L}
            y1=${PAD_T}
            x2=${PAD_L}
            y2=${SVG_H - PAD_B}
          />

          ${sweetRect
            ? svg`<rect
                class="pareto-plane__sweetspot"
                x=${sweetRect.x.toFixed(1)}
                y=${sweetRect.y.toFixed(1)}
                width=${sweetRect.w.toFixed(1)}
                height=${sweetRect.h.toFixed(1)}
                rx="4"
              />`
            : nothing}
          ${sortedPresets.length > 1
            ? svg`<polyline class="pareto-plane__frontier" points=${polylinePoints} />`
            : nothing}

          <line
            class="pareto-plane__crosshair-line"
            x1=${PAD_L}
            y1=${cy.toFixed(1)}
            x2=${svgW - PAD_R}
            y2=${cy.toFixed(1)}
          />
          <line
            class="pareto-plane__crosshair-line"
            x1=${cx.toFixed(1)}
            y1=${PAD_T}
            x2=${cx.toFixed(1)}
            y2=${SVG_H - PAD_B}
          />

          ${presets.map(preset => {
            const px = projectX(preset.x, xDomain, plotW);
            const py = projectY(preset.y, yDomain);
            const isSelected = preset.id === selectedPresetId;
            return svg`
              <g
                class="pareto-plane__node"
                data-preset-id=${preset.id}
                data-selected=${isSelected ? 'true' : 'false'}
                role="button"
                tabindex="0"
                aria-label=${`Frontier preset: ${preset.label}`}
                @click=${() => this.applyPreset(preset)}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.applyPreset(preset);
                  }
                }}
              >
                <circle cx=${px.toFixed(1)} cy=${py.toFixed(1)} r="9" fill="transparent" />
                <circle class="pareto-plane__node-dot" cx=${px.toFixed(1)} cy=${py.toFixed(1)} r="4.3" />
                <text
                  class="pareto-plane__node-label"
                  x=${px.toFixed(1)}
                  y=${(py - 7).toFixed(1)}
                  text-anchor="middle"
                >
                  ${preset.label}
                </text>
              </g>
            `;
          })}

          <g
            class="pareto-plane__crosshair"
            data-live-x=${String(liveXVal)}
            data-live-y=${String(liveYVal)}
          >
            <circle
              class="pareto-plane__crosshair-ring"
              cx=${cx.toFixed(1)}
              cy=${cy.toFixed(1)}
              r="6.5"
            />
            <circle
              class="pareto-plane__crosshair-core"
              cx=${cx.toFixed(1)}
              cy=${cy.toFixed(1)}
              r="2.6"
            />
            <text
              class="pareto-plane__crosshair-tag"
              x=${tagX.toFixed(1)}
              y=${tagY.toFixed(1)}
              text-anchor=${tagAnchor}
            >
              Current mix (${liveXVal}, ${liveYVal})
            </text>
          </g>

          <text class="pareto-plane__axis-label" x=${PAD_L} y=${SVG_H - 6}>${xDomain[0]}</text>
          <text
            class="pareto-plane__axis-label"
            x=${(PAD_L + plotW / 2).toFixed(1)}
            y=${SVG_H - 6}
            text-anchor="middle"
          >
            ${xLabel}
          </text>
          <text class="pareto-plane__axis-label" x=${svgW - PAD_R} y=${SVG_H - 6} text-anchor="end">
            ${xDomain[1]}
          </text>
          <text class="pareto-plane__axis-label" x="4" y=${PAD_T + 7}>${yDomain[1]}</text>
          <text class="pareto-plane__axis-label" x="4" y=${(PAD_T + PLOT_H / 2 + 3).toFixed(1)}>
            ${yLabel}
          </text>
          <text class="pareto-plane__axis-label" x="4" y=${SVG_H - PAD_B}>${yDomain[0]}</text>
        </svg>

        <div class="pareto-plane__chips" role="group" aria-label="Pareto frontier presets">
          ${presets.map(preset => {
            const isSelected = preset.id === selectedPresetId;
            return html`
              <button
                type="button"
                class="pareto-plane__chip"
                data-preset-chip=${preset.id}
                data-selected=${isSelected ? 'true' : 'false'}
                aria-pressed=${isSelected ? 'true' : 'false'}
                @click=${() => this.applyPreset(preset)}
              >
                ${preset.label}
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }
}

export const A2uiParetoPlane2D = {
  ...ParetoPlane2DApi,
  tagName: A2uiParetoPlane2DElement.tagName,
  element: A2uiParetoPlane2DElement,
};
