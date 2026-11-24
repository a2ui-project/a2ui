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
 * `TimelineStrip`: tactile day timeline with open-hours shading, walking leg pills,
 * conflict badges, `-15m`/`+15m` shift and duration controls, and an optional
 * `activeChild` slot rendered inside the selected stop.
 */

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  ChildSchema,
  type ComponentApi,
  DynamicNumberSchema,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import {computeTripStats, formatClock, parseStops, parseTripStats, type StopItem} from './model.js';

export const TimelineStripApi = {
  name: 'TimelineStrip',
  schema: spec(
    z
      .object({
        stops: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Writable array of itinerary stops bound to /stops.',
        ),
        selectedStopId: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Writable selected stop ID bound to /selectedStopId.',
        ),
        stats: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Optional live tripStats result with per-stop leg and conflict diagnostics.',
        ).optional(),
        dayStartMin: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Start of the open-hours bar window in minutes from midnight.',
        ).optional(),
        dayEndMin: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|End of the open-hours bar window in minutes from midnight.',
        ).optional(),
        activeChild: ChildSchema.describe(
          'REF:#/$defs/Child|Optional child component slotted inside the selected stop.',
        ).optional(),
      })
      .describe(
        'Interactive day itinerary timeline with shift controls, open-hours shading, and child slot.',
      )
      .strict(),
    {mixins: [], required: ['stops', 'selectedStopId']},
  ),
} satisfies ComponentApi;

function pct(val: number, min: number, max: number): number {
  const span = Math.max(60, max - min);
  return Math.max(0, Math.min(100, ((val - min) / span) * 100));
}

/**
 * @cssprop [--a2ui-timelinestrip-gap=4px] - Vertical spacing between timeline rows.
 */
export class A2uiTimelineStripElement extends A2uiLitElement<typeof TimelineStripApi> {
  static readonly tagName = 'a2ui-trip-timeline-strip';

  static override styles = css`
    :host {
      display: block;
    }
    .ts-tl {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-timelinestrip-gap, 4px);
    }
    .ts-tl__leg {
      display: flex;
      align-items: center;
      gap: 6px;
      padding-left: 12px;
      min-height: 18px;
      font-size: 10.5px;
    }
    .ts-tl__leg-line {
      width: 2px;
      height: 14px;
      border-radius: 1px;
      background: var(--color-border-primary, light-dark(#cbd5e1, #475569));
    }
    .ts-tl__leg-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 7px;
      border-radius: 999px;
      font-weight: 600;
      background: var(--color-background-secondary, light-dark(#f1f5f9, #282c34));
      color: var(--color-text-secondary, light-dark(#475569, #94a3b8));
      border: 1px solid var(--color-border-primary, light-dark(#e2e8f0, #3b4252));
    }
    .ts-tl__warn {
      display: inline-flex;
      align-items: center;
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      background: light-dark(#fef3c7, #422c10);
      color: light-dark(#b45309, #fcd34d);
      border: 1px solid light-dark(#f59e0b, #784f17);
    }
    .ts-tl__card {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 7px 9px;
      border-radius: 9px;
      background: var(
        --color-background-secondary,
        var(--a2ui-color-surface, light-dark(#f8fafc, #25272a))
      );
      border: 1px solid var(--color-border-primary, light-dark(#e2e8f0, #383b3f));
      transition: border-color 120ms ease;
    }
    .ts-tl__card--selected {
      background: var(--color-background-primary, light-dark(#ffffff, #202328));
      border-color: var(--color-ring-primary, light-dark(#2563eb, #60a5fa));
      box-shadow: 0 0 0 1px var(--color-ring-primary, light-dark(#2563eb, #60a5fa));
    }
    .ts-tl__card--conflict {
      border-color: light-dark(#d97706, #f59e0b);
    }
    .ts-tl__row-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .ts-tl__main {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
      flex-wrap: wrap;
    }
    .ts-tl__time {
      font-size: 11px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--color-ring-primary, light-dark(#1d4ed8, #93c5fd));
      white-space: nowrap;
    }
    .ts-tl__title {
      font-size: 12.5px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ts-tl__env {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 4px;
      background: light-dark(#e0f2fe, #1e3a5f);
      color: light-dark(#0369a1, #93c5fd);
    }
    .ts-tl__env--outdoor {
      background: light-dark(#fef3c7, #3f2f16);
      color: light-dark(#92400e, #fcd34d);
    }
    .ts-tl__cost {
      font-size: 11px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--color-text-secondary, light-dark(#475569, #9ca3af));
      white-space: nowrap;
    }
    .ts-tl__hours-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ts-tl__track {
      position: relative;
      flex: 1;
      height: 5px;
      border-radius: 999px;
      background: light-dark(#e2e8f0, #343840);
      overflow: hidden;
    }
    .ts-tl__open-band {
      position: absolute;
      top: 0;
      bottom: 0;
      background: light-dark(#bbf7d0, #1e4631);
    }
    .ts-tl__visit-band {
      position: absolute;
      top: 0;
      bottom: 0;
      border-radius: 999px;
      background: var(--color-ring-primary, #2563eb);
    }
    .ts-tl__visit-band--warn {
      background: #dc2626;
    }
    .ts-tl__hours-text {
      font-size: 10px;
      color: var(--color-text-secondary, light-dark(#64748b, #9ca3af));
      white-space: nowrap;
    }
    .ts-tl__controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: wrap;
      padding-top: 2px;
    }
    .ts-tl__btn-group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .ts-tl__ctrl-label {
      font-size: 10.5px;
      color: var(--color-text-secondary, light-dark(#64748b, #9ca3af));
    }
    .ts-tl__btn {
      padding: 2px 7px;
      border-radius: 6px;
      border: 1px solid var(--color-border-primary, light-dark(#cbd5e1, #475569));
      background: var(--color-background-secondary, light-dark(#f8fafc, #2d3139));
      color: var(--color-text-primary, light-dark(#1e293b, #e2e8f0));
      font: inherit;
      font-size: 10.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .ts-tl__btn:hover {
      border-color: var(--color-ring-primary, #2563eb);
    }
    .ts-tl__slot {
      padding-top: 4px;
      border-top: 1px dashed var(--color-border-primary, light-dark(#dbe2ea, #3a3f47));
    }
  `;

  protected override readonly api = TimelineStripApi;

  private selectStop(stopId: string): void {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    const setter = props?.['setSelectedStopId'];
    if (typeof setter === 'function') {
      (setter as (id: string) => void)(stopId);
    }
  }

  private updateStop(stops: StopItem[], stopId: string, patch: Partial<StopItem>): void {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    const setter = props?.['setStops'];
    if (typeof setter !== 'function') return;
    const next = stops.map(item => (item.id === stopId ? {...item, ...patch} : item));
    (setter as (items: StopItem[]) => void)(next);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const stops = parseStops(props['stops']);
    if (stops.length === 0) return nothing;

    const selectedId =
      typeof props['selectedStopId'] === 'string' ? props['selectedStopId'] : stops[0]!.id;
    const stats = parseTripStats(props['stats']) ?? computeTripStats(stops, undefined, 0);

    const minWindow =
      typeof props['dayStartMin'] === 'number'
        ? props['dayStartMin']
        : Math.min(...stops.map(s => Math.min(s.openMin, s.startMin))) - 30;
    const maxWindow =
      typeof props['dayEndMin'] === 'number'
        ? props['dayEndMin']
        : Math.max(...stops.map(s => Math.max(s.closeMin, s.startMin + s.durationMin))) + 30;

    const activeChild = props['activeChild'];
    const hasSlot = activeChild !== undefined && this.isChildResolved(activeChild);

    return html`
      <div class="ts-tl" role="region" aria-label="Day timeline">
        ${stops.map((stop, idx) => {
          const diag = stats.byStop[stop.id];
          const selected = stop.id === selectedId;
          const endMin = stop.startMin + stop.durationMin;
          const openLeft = pct(stop.openMin, minWindow, maxWindow);
          const openWidth = Math.max(2, pct(stop.closeMin, minWindow, maxWindow) - openLeft);
          const visitLeft = pct(stop.startMin, minWindow, maxWindow);
          const visitWidth = Math.max(3, pct(endMin, minWindow, maxWindow) - visitLeft);

          return html`
            ${diag && (idx > 0 || diag.walkMin > 0)
              ? html`
                  <div class="ts-tl__leg">
                    <span class="ts-tl__leg-line" aria-hidden="true"></span>
                    <span class="ts-tl__leg-pill">${diag.walkMin}m walk</span>
                    ${diag.rushWarning
                      ? html`<span class="ts-tl__warn">${diag.rushWarning}</span>`
                      : nothing}
                  </div>
                `
              : nothing}
            <div
              class="ts-tl__card ${selected ? 'ts-tl__card--selected' : ''} ${diag?.hasConflict
                ? 'ts-tl__card--conflict'
                : ''}"
            >
              <button
                type="button"
                class="ts-tl__row-btn"
                aria-pressed=${selected ? 'true' : 'false'}
                @click=${() => this.selectStop(stop.id)}
              >
                <span class="ts-tl__main">
                  <span class="ts-tl__time"
                    >${formatClock(stop.startMin)}–${formatClock(endMin)}</span
                  >
                  <span class="ts-tl__title">${stop.title}</span>
                  <span class="ts-tl__env ${stop.indoor ? '' : 'ts-tl__env--outdoor'}">
                    ${stop.indoor ? 'Indoor' : 'Outdoor'}
                  </span>
                </span>
                <span class="ts-tl__cost">${stop.cost > 0 ? `$${stop.cost}` : 'Included'}</span>
              </button>

              <div class="ts-tl__hours-row">
                <div class="ts-tl__track" aria-hidden="true">
                  <div
                    class="ts-tl__open-band"
                    style="left:${openLeft.toFixed(1)}%;width:${openWidth.toFixed(1)}%"
                  ></div>
                  <div
                    class="ts-tl__visit-band ${diag?.hoursWarning ? 'ts-tl__visit-band--warn' : ''}"
                    style="left:${visitLeft.toFixed(1)}%;width:${visitWidth.toFixed(1)}%"
                  ></div>
                </div>
                ${diag?.hoursWarning
                  ? html`<span class="ts-tl__warn">${diag.hoursWarning}</span>`
                  : html`<span class="ts-tl__hours-text"
                      >Open ${formatClock(stop.openMin)}–${formatClock(stop.closeMin)}</span
                    >`}
              </div>

              ${selected
                ? html`
                    <div class="ts-tl__controls">
                      ${stop.locked
                        ? html`<span class="ts-tl__ctrl-label"
                            >Fixed anchor · ${stop.durationMin}m</span
                          >`
                        : html`
                            <div class="ts-tl__btn-group">
                              <span class="ts-tl__ctrl-label">Shift:</span>
                              <button
                                type="button"
                                class="ts-tl__btn"
                                @click=${() =>
                                  this.updateStop(stops, stop.id, {
                                    startMin: Math.max(360, stop.startMin - 15),
                                  })}
                              >
                                -15m
                              </button>
                              <button
                                type="button"
                                class="ts-tl__btn"
                                @click=${() =>
                                  this.updateStop(stops, stop.id, {
                                    startMin: Math.min(1380, stop.startMin + 15),
                                  })}
                              >
                                +15m
                              </button>
                            </div>
                            <div class="ts-tl__btn-group">
                              <span class="ts-tl__ctrl-label">Stay ${stop.durationMin}m:</span>
                              <button
                                type="button"
                                class="ts-tl__btn"
                                @click=${() =>
                                  this.updateStop(stops, stop.id, {
                                    durationMin: Math.max(15, stop.durationMin - 15),
                                  })}
                              >
                                Shorter
                              </button>
                              <button
                                type="button"
                                class="ts-tl__btn"
                                @click=${() =>
                                  this.updateStop(stops, stop.id, {
                                    durationMin: Math.min(240, stop.durationMin + 15),
                                  })}
                              >
                                Longer
                              </button>
                            </div>
                          `}
                    </div>
                    ${hasSlot
                      ? html`<div class="ts-tl__slot">${this.renderNode(activeChild)}</div>`
                      : nothing}
                  `
                : nothing}
            </div>
          `;
        })}
      </div>
    `;
  }
}

export const A2uiTimelineStrip = {
  ...TimelineStripApi,
  tagName: A2uiTimelineStripElement.tagName,
  element: A2uiTimelineStripElement,
};
