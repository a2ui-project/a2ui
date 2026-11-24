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
 * `SwapDeck`: tactile option cards (`★ Agent pick` vs `Rain backup` vs `Budget pick`)
 * that swap a stop in `/stops` or the basecamp hotel in `/hotel` client-side on click.
 */

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  type ComponentApi,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import {
  parseHotel,
  parseStops,
  parseStopSwapsMap,
  parseSwapList,
  type HotelItem,
  type StopItem,
  type SwapOption,
} from './model.js';

export const SwapDeckApi = {
  name: 'SwapDeck',
  schema: spec(
    z
      .object({
        mode: z
          .enum(['stop', 'hotel'])
          .describe('Whether clicking an option swaps a stop in /stops or the hotel in /hotel.'),
        title: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional deck section heading.',
        ).optional(),
        options: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|For stop mode, map of stopId -> SwapOption[]; for hotel mode, SwapOption[].',
        ),
        selectedStopId: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Selected stop ID when mode is stop.',
        ).optional(),
        stops: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Writable /stops array when mode is stop.',
        ).optional(),
        hotel: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Writable /hotel object when mode is hotel.',
        ).optional(),
      })
      .describe('Tactile swap deck for comparing and applying stop or hotel alternatives.')
      .strict(),
    {mixins: [], required: ['mode', 'options']},
  ),
} satisfies ComponentApi;

function badgeTone(badge: string): string {
  const lower = badge.toLowerCase();
  if (badge.includes('★') || lower.includes('agent')) return 'agent';
  if (lower.includes('rain') || lower.includes('indoor')) return 'rain';
  return 'budget';
}

/**
 * @cssprop [--a2ui-swapdeck-gap=6px] - Grid gap between option cards.
 */
export class A2uiSwapDeckElement extends A2uiLitElement<typeof SwapDeckApi> {
  static readonly tagName = 'a2ui-trip-swap-deck';

  static override styles = css`
    :host {
      display: block;
    }
    .ts-swap {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .ts-swap__title {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-secondary, light-dark(#5f6368, #9aa0a6));
    }
    .ts-swap__grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--a2ui-swapdeck-gap, 6px);
    }
    @media (max-width: 480px) {
      .ts-swap__grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .ts-swap__card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 3px;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid var(--color-border-primary, light-dark(#dbe2ea, #3c4043));
      background: var(--color-background-secondary, light-dark(#f8fafc, #282a2e));
      color: var(--color-text-primary, light-dark(#1f2937, #e5e7eb));
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .ts-swap__card:hover {
      border-color: var(--color-ring-primary, #2563eb);
    }
    .ts-swap__card--active {
      background: light-dark(#eff6ff, #1e2b42);
      border-color: var(--color-ring-primary, light-dark(#2563eb, #60a5fa));
      box-shadow: inset 0 0 0 1px var(--color-ring-primary, light-dark(#2563eb, #60a5fa));
    }
    .ts-swap__top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
      width: 100%;
    }
    .ts-swap__badge {
      font-size: 9.5px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 4px;
      white-space: nowrap;
    }
    .ts-swap__badge--agent {
      background: light-dark(#dbeafe, #1e3a8a);
      color: light-dark(#1e40af, #bfdbfe);
    }
    .ts-swap__badge--rain {
      background: light-dark(#e0f2fe, #164e63);
      color: light-dark(#0369a1, #a5f3fc);
    }
    .ts-swap__badge--budget {
      background: light-dark(#dcfce7, #14532d);
      color: light-dark(#15803d, #bbf7d0);
    }
    .ts-swap__price {
      font-size: 10.5px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--color-text-secondary, light-dark(#475569, #cbd5e1));
    }
    .ts-swap__name {
      font-size: 11.5px;
      font-weight: 700;
      line-height: 1.25;
    }
    .ts-swap__reason {
      font-size: 10px;
      line-height: 1.3;
      color: var(--color-text-secondary, light-dark(#64748b, #9ca3af));
    }
  `;

  protected override readonly api = SwapDeckApi;

  private applyStopSwap(stops: StopItem[], stopId: string, option: SwapOption): void {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    const setter = props?.['setStops'];
    if (typeof setter !== 'function') return;
    const next = stops.map(stop => {
      if (stop.id !== stopId) return stop;
      return {
        ...stop,
        title: option.title,
        area: option.area || stop.area,
        category: option.category,
        cost: option.cost,
        durationMin: option.durationMin ?? stop.durationMin,
        openMin: option.openMin ?? stop.openMin,
        closeMin: option.closeMin ?? stop.closeMin,
        indoor: option.indoor ?? stop.indoor,
        x: option.x,
        y: option.y,
        optionId: option.id,
      };
    });
    (setter as (items: StopItem[]) => void)(next);
  }

  private applyHotelSwap(current: HotelItem | undefined, option: SwapOption): void {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    const setter = props?.['setHotel'];
    if (typeof setter !== 'function') return;
    const next: HotelItem = {
      id: option.id,
      name: option.title,
      area: option.area || current?.area || 'Center',
      nights: option.nights ?? current?.nights ?? 2,
      totalCost: option.cost,
      transitCost: option.transitCost ?? 0,
      x: option.x,
      y: option.y,
      tag: option.badge,
    };
    (setter as (hotel: HotelItem) => void)(next);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const mode = props['mode'];
    const title = typeof props['title'] === 'string' ? props['title'] : '';

    if (mode === 'hotel') {
      const options = parseSwapList(props['options']);
      if (options.length === 0) return nothing;
      const hotel = parseHotel(props['hotel']);
      return html`
        <div class="ts-swap" role="region" aria-label=${title || 'Hotel options'}>
          ${title ? html`<span class="ts-swap__title">${title}</span>` : nothing}
          <div class="ts-swap__grid">
            ${options.map(option => {
              const active = hotel?.id === option.id || hotel?.name === option.title;
              const tone = badgeTone(option.badge);
              return html`
                <button
                  type="button"
                  class="ts-swap__card ${active ? 'ts-swap__card--active' : ''}"
                  aria-pressed=${active ? 'true' : 'false'}
                  @click=${() => this.applyHotelSwap(hotel, option)}
                >
                  <span class="ts-swap__top">
                    <span class="ts-swap__badge ts-swap__badge--${tone}">${option.badge}</span>
                    <span class="ts-swap__price">$${option.cost}</span>
                  </span>
                  <span class="ts-swap__name">${option.title}</span>
                  <span class="ts-swap__reason">${option.reason}</span>
                </button>
              `;
            })}
          </div>
        </div>
      `;
    }

    const stops = parseStops(props['stops']);
    const selectedId =
      typeof props['selectedStopId'] === 'string' ? props['selectedStopId'] : (stops[0]?.id ?? '');
    const map = parseStopSwapsMap(props['options']);
    const options = map[selectedId] ?? [];
    if (options.length === 0) return nothing;
    const activeStop = stops.find(s => s.id === selectedId);

    return html`
      <div class="ts-swap" role="region" aria-label=${title || 'Stop alternatives'}>
        ${title ? html`<span class="ts-swap__title">${title}</span>` : nothing}
        <div class="ts-swap__grid">
          ${options.map(option => {
            const active = activeStop?.optionId === option.id || activeStop?.title === option.title;
            const tone = badgeTone(option.badge);
            return html`
              <button
                type="button"
                class="ts-swap__card ${active ? 'ts-swap__card--active' : ''}"
                aria-pressed=${active ? 'true' : 'false'}
                @click=${() => this.applyStopSwap(stops, selectedId, option)}
              >
                <span class="ts-swap__top">
                  <span class="ts-swap__badge ts-swap__badge--${tone}">${option.badge}</span>
                  <span class="ts-swap__price"
                    >${option.cost > 0 ? `$${option.cost}` : 'Free'}</span
                  >
                </span>
                <span class="ts-swap__name">${option.title}</span>
                <span class="ts-swap__reason">${option.reason}</span>
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }
}

export const A2uiSwapDeck = {
  ...SwapDeckApi,
  tagName: A2uiSwapDeckElement.tagName,
  element: A2uiSwapDeckElement,
};
