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
 * `RouteMinimap`: pure-SVG projected neighborhood map plotting stops, basecamp hotel,
 * walking-radius rings, and transit polylines. Clicking a pin updates `/selectedStopId`.
 */

import {css, html, nothing, svg} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  type ComponentApi,
  DynamicNumberSchema,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import {estimateWalkMinutes, formatClock, parseHotel, parseStops} from './model.js';

export const RouteMinimapApi = {
  name: 'RouteMinimap',
  schema: spec(
    z
      .object({
        stops: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Ordered array of itinerary stops with projected x/y coords.',
        ),
        hotel: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Optional basecamp hotel marker with projected x/y coords.',
        ).optional(),
        selectedStopId: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Writable binding to /selectedStopId.',
        ),
        neighborhood: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Neighborhood label shown in map header.',
        ).optional(),
        walkRadiusMinutes: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Walking-radius ring size in minutes (default 15).',
        ).optional(),
      })
      .describe('Pure-SVG projected neighborhood route map with interactive stop pins.')
      .strict(),
    {mixins: [], required: ['stops', 'selectedStopId']},
  ),
} satisfies ComponentApi;

const MAP_W = 280;
const MAP_H = 196;
const PAD_X = 24;
const PAD_Y = 22;

function projectX(x: number): number {
  return PAD_X + (Math.max(0, Math.min(100, x)) / 100) * (MAP_W - PAD_X * 2);
}

function projectY(y: number): number {
  return PAD_Y + (Math.max(0, Math.min(100, y)) / 100) * (MAP_H - PAD_Y * 2);
}

/**
 * @cssprop [--a2ui-routeminimap-bg=var(--color-background-secondary)] - Map panel background.
 */
export class A2uiRouteMinimapElement extends A2uiLitElement<typeof RouteMinimapApi> {
  static readonly tagName = 'a2ui-trip-route-minimap';

  static override styles = css`
    :host {
      display: block;
    }
    .ts-map {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(
        --a2ui-routeminimap-bg,
        var(--color-background-secondary, var(--a2ui-color-surface, light-dark(#f6f8fc, #26282b)))
      );
      border: 1px solid var(--color-border-primary, light-dark(#e0e4eb, #383b3f));
    }
    .ts-map__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .ts-map__title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-secondary, light-dark(#5f6368, #9aa0a6));
    }
    .ts-map__ring-note {
      font-size: 10.5px;
      color: var(--color-text-secondary, light-dark(#5f6368, #9aa0a6));
    }
    .ts-map__canvas {
      display: block;
      width: 100%;
      height: auto;
      max-height: 196px;
      border-radius: 8px;
      background: light-dark(#eef3fa, #1b2028);
      border: 1px solid light-dark(#d8e2ef, #2e3642);
    }
    .ts-map__pin {
      cursor: pointer;
    }
    .ts-map__pin:focus-visible {
      outline: none;
    }
    .ts-map__leg-pill {
      fill: light-dark(#ffffff, #1e293b);
    }
    .ts-map__leg-label {
      font-size: 8.5px;
      font-weight: 700;
      fill: light-dark(#1e3a8a, #bfdbfe);
    }
    .ts-map__pin-num {
      font-size: 9.5px;
      font-weight: 800;
      fill: #ffffff;
      pointer-events: none;
    }
    .ts-map__pin-caption {
      font-size: 8.5px;
      font-weight: 600;
      fill: light-dark(#1f2937, #e5e7eb);
      pointer-events: none;
    }
    .ts-map__selected {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font-size: 11px;
      padding-top: 2px;
    }
    .ts-map__selected-name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ts-map__selected-meta {
      color: var(--color-text-secondary, light-dark(#5f6368, #9aa0a6));
      white-space: nowrap;
    }
  `;

  protected override readonly api = RouteMinimapApi;

  private selectStop(stopId: string): void {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    const setter = props?.['setSelectedStopId'];
    if (typeof setter === 'function') {
      (setter as (id: string) => void)(stopId);
    }
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const stops = parseStops(props['stops']);
    const hotel = parseHotel(props['hotel']);
    const selectedId =
      typeof props['selectedStopId'] === 'string' ? props['selectedStopId'] : (stops[0]?.id ?? '');
    const neighborhood =
      typeof props['neighborhood'] === 'string' ? props['neighborhood'] : 'Route Map';
    const radiusMin =
      typeof props['walkRadiusMinutes'] === 'number' ? props['walkRadiusMinutes'] : 15;
    const radiusPx = Math.round((radiusMin / 0.34) * ((MAP_W - PAD_X * 2) / 100));

    const selectedStop = stops.find(s => s.id === selectedId) ?? stops[0];
    const ringCenter = selectedStop
      ? {cx: projectX(selectedStop.x), cy: projectY(selectedStop.y)}
      : hotel
        ? {cx: projectX(hotel.x), cy: projectY(hotel.y)}
        : {cx: MAP_W / 2, cy: MAP_H / 2};

    const segments: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      minutes: number;
      dashed: boolean;
    }> = [];

    if (hotel && stops[0] && stops[0].category !== 'stay') {
      segments.push({
        x1: projectX(hotel.x),
        y1: projectY(hotel.y),
        x2: projectX(stops[0].x),
        y2: projectY(stops[0].y),
        minutes: estimateWalkMinutes(hotel.x, hotel.y, stops[0].x, stops[0].y),
        dashed: true,
      });
    }
    for (let i = 1; i < stops.length; i++) {
      const prev = stops[i - 1]!;
      const curr = stops[i]!;
      segments.push({
        x1: projectX(prev.x),
        y1: projectY(prev.y),
        x2: projectX(curr.x),
        y2: projectY(curr.y),
        minutes: estimateWalkMinutes(prev.x, prev.y, curr.x, curr.y),
        dashed: false,
      });
    }

    return html`
      <div class="ts-map" role="region" aria-label="Neighborhood route minimap">
        <div class="ts-map__head">
          <span class="ts-map__title">${neighborhood}</span>
          <span class="ts-map__ring-note">Ring = ${radiusMin}m walk</span>
        </div>
        <svg class="ts-map__canvas" viewBox="0 0 ${MAP_W} ${MAP_H}">
          <path
            d="M 0 150 Q 95 132 168 164 T 280 142"
            fill="none"
            stroke="#60a5fa"
            stroke-opacity="0.28"
            stroke-width="12"
          />
          <path
            d="M 48 0 V ${MAP_H} M 140 0 V ${MAP_H} M 225 0 V ${MAP_H} M 0 56 H ${MAP_W} M 0 118 H ${MAP_W}"
            stroke="#94a3b8"
            stroke-opacity="0.18"
            stroke-width="1"
          />
          <circle
            cx="${ringCenter.cx.toFixed(1)}"
            cy="${ringCenter.cy.toFixed(1)}"
            r="${radiusPx}"
            fill="#3b82f6"
            fill-opacity="0.06"
            stroke="#3b82f6"
            stroke-opacity="0.35"
            stroke-dasharray="3 3"
          />
          ${segments.map(seg => {
            const mx = (seg.x1 + seg.x2) / 2;
            const my = (seg.y1 + seg.y2) / 2;
            return svg`
              <g>
                <line
                  x1="${seg.x1.toFixed(1)}"
                  y1="${seg.y1.toFixed(1)}"
                  x2="${seg.x2.toFixed(1)}"
                  y2="${seg.y2.toFixed(1)}"
                  stroke="#3b82f6"
                  stroke-width="2"
                  stroke-dasharray=${seg.dashed ? '4 3' : 'none'}
                />
                <rect
                  x="${(mx - 14).toFixed(1)}"
                  y="${(my - 7).toFixed(1)}"
                  width="28"
                  height="13"
                  rx="6"
                  class="ts-map__leg-pill"
                  fill-opacity="0.88"
                />
                <text x="${mx.toFixed(1)}" y="${(my + 2.5).toFixed(1)}" text-anchor="middle" class="ts-map__leg-label">
                  ${seg.minutes}m
                </text>
              </g>
            `;
          })}
          ${hotel
            ? svg`
                <g transform="translate(${projectX(hotel.x).toFixed(1)}, ${projectY(hotel.y).toFixed(1)})">
                  <rect
                    x="-8"
                    y="-8"
                    width="16"
                    height="16"
                    rx="4"
                    fill="#7c3aed"
                    stroke="#ffffff"
                    stroke-width="1.5"
                  />
                  <path d="M-4 1 L0 -3.5 L4 1 V4 H-4 Z" fill="#ffffff" />
                </g>
              `
            : nothing}
          ${stops.map((stop, idx) => {
            const px = projectX(stop.x);
            const py = projectY(stop.y);
            const active = stop.id === selectedId;
            return svg`
              <g
                class="ts-map__pin"
                role="button"
                tabindex="0"
                aria-label="Pin ${idx + 1}: ${stop.title}"
                @click=${() => this.selectStop(stop.id)}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.selectStop(stop.id);
                  }
                }}
              >
                ${
                  active
                    ? svg`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="14" fill="#2563eb" fill-opacity="0.22" />`
                    : nothing
                }
                <circle
                  cx="${px.toFixed(1)}"
                  cy="${py.toFixed(1)}"
                  r="${active ? 10 : 8.5}"
                  fill="${active ? '#1d4ed8' : '#334155'}"
                  stroke="#ffffff"
                  stroke-width="1.8"
                />
                <text x="${px.toFixed(1)}" y="${(py + 3.3).toFixed(1)}" text-anchor="middle" class="ts-map__pin-num">
                  ${idx + 1}
                </text>
                <text x="${px.toFixed(1)}" y="${(py + (py > MAP_H - 26 ? -13 : 19)).toFixed(1)}" text-anchor="middle" class="ts-map__pin-caption">
                  ${stop.area}
                </text>
              </g>
            `;
          })}
        </svg>
        ${selectedStop
          ? html`
              <div class="ts-map__selected">
                <span class="ts-map__selected-name"
                  >${selectedStop.title} · ${selectedStop.area}</span
                >
                <span class="ts-map__selected-meta"
                  >${formatClock(selectedStop.startMin)} ·
                  ${selectedStop.indoor ? 'Indoor' : 'Outdoor'}</span
                >
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

export const A2uiRouteMinimap = {
  ...RouteMinimapApi,
  tagName: A2uiRouteMinimapElement.tagName,
  element: A2uiRouteMinimapElement,
};
