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

/** `WeatherRibbon`: compact hourly SVG temperature + rain spark-ribbon aligned to day hours. */

import {css, html, nothing, svg} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  type ComponentApi,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import {parseWeatherHours, type WeatherCondition} from './model.js';

export const WeatherRibbonApi = {
  name: 'WeatherRibbon',
  schema: spec(
    z
      .object({
        hours: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Hourly weather array with hour, label, tempC, rainPct, condition.',
        ),
        alertText: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional weather window callout pill.',
        ).optional(),
      })
      .describe('Hourly inline-SVG temperature and precipitation spark-ribbon.')
      .strict(),
    {mixins: [], required: ['hours']},
  ),
} satisfies ComponentApi;

function renderWeatherIcon(condition: WeatherCondition, cx: number, cy: number) {
  if (condition === 'sun') {
    return svg`
      <g transform="translate(${cx}, ${cy})">
        <circle cx="0" cy="0" r="4" fill="#f59e0b" />
        <path
          d="M0 -6.5 V-5 M0 5 V6.5 M-6.5 0 H-5 M5 0 H6.5 M-4.6 -4.6 L-3.5 -3.5 M3.5 3.5 L4.6 4.6 M4.6 -4.6 L3.5 -3.5 M-3.5 3.5 L-4.6 4.6"
          stroke="#f59e0b"
          stroke-width="1.2"
          stroke-linecap="round"
        />
      </g>
    `;
  }
  if (condition === 'rain') {
    return svg`
      <g transform="translate(${cx}, ${cy})">
        <path
          d="M-4.5 0.5 a3 3 0 0 1 0.6 -5.9 a3.8 3.8 0 0 1 7.2 0.8 a2.6 2.6 0 0 1 0.9 5.1 Z"
          fill="#3b82f6"
        />
        <path
          d="M-2.2 2.4 L-3 4.8 M0.8 2.4 L0 4.8 M3.6 2.4 L2.8 4.8"
          stroke="#60a5fa"
          stroke-width="1.2"
          stroke-linecap="round"
        />
      </g>
    `;
  }
  return svg`
    <g transform="translate(${cx}, ${cy})">
      <path
        d="M-4.5 1.5 a3 3 0 0 1 0.6 -5.9 a3.8 3.8 0 0 1 7.2 0.8 a2.6 2.6 0 0 1 0.9 5.1 Z"
        fill="#94a3b8"
      />
    </g>
  `;
}

/**
 * @cssprop [--a2ui-weatherribbon-bg=var(--color-background-secondary)] - Ribbon container fill.
 */
export class A2uiWeatherRibbonElement extends A2uiLitElement<typeof WeatherRibbonApi> {
  static readonly tagName = 'a2ui-trip-weather-ribbon';

  static override styles = css`
    :host {
      display: block;
    }
    .ts-weather {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 7px 10px;
      border-radius: 9px;
      background: var(
        --a2ui-weatherribbon-bg,
        var(--color-background-secondary, var(--a2ui-color-surface, light-dark(#f6f8fc, #26282b)))
      );
      border: 1px solid var(--color-border-primary, light-dark(#e3e7ed, #383b3f));
    }
    .ts-weather__top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .ts-weather__label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-secondary, light-dark(#5f6368, #9aa0a6));
    }
    .ts-weather__alert {
      font-size: 11px;
      font-weight: 600;
      padding: 1px 7px;
      border-radius: 999px;
      background: light-dark(#dbeafe, #1e3a5f);
      color: light-dark(#1d4ed8, #93c5fd);
    }
    .ts-weather__svg {
      display: block;
      width: 100%;
      height: 48px;
      overflow: visible;
    }
    .ts-weather__hour-text {
      font-size: 9.5px;
      font-weight: 600;
      fill: var(--color-text-secondary, light-dark(#5f6368, #a8abb0));
    }
    .ts-weather__temp-text {
      font-size: 9.5px;
      font-weight: 700;
      fill: var(--color-text-primary, light-dark(#1f1f1f, #e3e3e3));
    }
    .ts-weather__rain-text {
      font-size: 8.5px;
      font-weight: 700;
      fill: light-dark(#1d4ed8, #93c5fd);
    }
  `;

  protected override readonly api = WeatherRibbonApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const hours = parseWeatherHours(props['hours']);
    if (hours.length === 0) return nothing;
    const alertText = typeof props['alertText'] === 'string' ? props['alertText'] : '';

    const width = 640;
    const height = 48;
    const step = width / hours.length;
    const temps = hours.map(h => h.tempC);
    const minT = Math.min(...temps);
    const maxT = Math.max(...temps);
    const spanT = Math.max(1, maxT - minT);

    const points = hours.map((h, idx) => {
      const x = step * idx + step * 0.5;
      const y = 29 - ((h.tempC - minT) / spanT) * 5.5;
      return {x, y, h};
    });
    const linePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    return html`
      <div class="ts-weather" role="region" aria-label="Hourly weather forecast">
        <div class="ts-weather__top">
          <span class="ts-weather__label">Hourly Sky &amp; Rain Window</span>
          ${alertText ? html`<span class="ts-weather__alert">${alertText}</span>` : nothing}
        </div>
        <svg class="ts-weather__svg" viewBox="0 0 ${width} ${height}" aria-hidden="true">
          <polyline
            points=${linePoints}
            fill="none"
            stroke="var(--color-ring-primary, #3b82f6)"
            stroke-width="1.6"
            stroke-opacity="0.55"
          />
          ${points.map(
            ({x, y, h}) => svg`
              <g>
                ${
                  h.rainPct >= 40
                    ? svg`<rect
                      x="${(x - step * 0.42).toFixed(1)}"
                      y="1"
                      width="${(step * 0.84).toFixed(1)}"
                      height="${height - 2}"
                      rx="5"
                      fill="#3b82f6"
                      fill-opacity="0.13"
                    />`
                    : nothing
                }
                <text x="${x.toFixed(1)}" y="9" text-anchor="middle" class="ts-weather__hour-text">
                  ${h.label}
                </text>
                ${renderWeatherIcon(h.condition, x, 17.5)}
                <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#3b82f6" />
                <text x="${x.toFixed(1)}" y="38" text-anchor="middle" class="ts-weather__temp-text">
                  ${h.tempC}°
                </text>
                ${
                  h.rainPct >= 25
                    ? svg`<text
                      x="${x.toFixed(1)}"
                      y="46.5"
                      text-anchor="middle"
                      class="ts-weather__rain-text"
                    >
                      ${h.rainPct}%
                    </text>`
                    : nothing
                }
              </g>
            `,
          )}
        </svg>
      </div>
    `;
  }
}

export const A2uiWeatherRibbon = {
  ...WeatherRibbonApi,
  tagName: A2uiWeatherRibbonElement.tagName,
  element: A2uiWeatherRibbonElement,
};
