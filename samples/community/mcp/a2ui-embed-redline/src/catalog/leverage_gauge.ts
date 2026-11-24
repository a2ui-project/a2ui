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
 * `LeverageGauge`: SVG deal-friction dial/bar bound to
 * `@call: negotiationMetrics(/clauses, /stances)`.
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

import {REDLINE_TOKENS} from './theme_tokens.js';

export const LeverageGaugeApi = {
  name: 'LeverageGauge',
  schema: spec(
    z
      .object({
        label: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional heading label for the leverage gauge.',
        ).optional(),
        metrics: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Live metrics object from @call: negotiationMetrics(/clauses, /stances).',
        ),
      })
      .describe(
        'SVG deal-friction gauge showing acceptance odds vs over-pushed counterparty walk risk.',
      )
      .strict(),
    {mixins: [], required: ['metrics']},
  ),
} satisfies ComponentApi;

function field<T>(obj: unknown, key: string, fallback: T): T {
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === typeof fallback) return val as T;
  }
  return fallback;
}

export class A2uiLeverageGaugeElement extends A2uiLitElement<typeof LeverageGaugeApi> {
  static readonly tagName = 'a2ui-redline-leverage';

  static override styles = [
    REDLINE_TOKENS,
    css`
      :host {
        display: block;
      }
      .rl-lev {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 3px;
        padding: 6px 9px;
        border: 1px solid var(--rl-border);
        border-radius: 8px;
        background: var(--rl-surface);
      }
      .rl-lev__hdr {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
      }
      .rl-lev__lbl {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--rl-muted);
      }
      .rl-lev__score {
        font-size: 10.5px;
        font-weight: 700;
        font-family: var(--rl-mono);
        color: var(--rl-text);
      }
      .rl-lev__verdict {
        font-size: 12px;
        font-weight: 700;
        line-height: 1.25;
      }
      .rl-lev__verdict--low {
        color: var(--rl-good);
      }
      .rl-lev__verdict--balanced {
        color: var(--rl-primary);
      }
      .rl-lev__verdict--high {
        color: var(--rl-danger);
      }
      .rl-lev__svg {
        display: block;
        width: 100%;
        height: 14px;
      }
    `,
  ];

  protected override readonly api = LeverageGaugeApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const metrics = props.metrics;
    const score = Math.max(0, Math.min(100, field<number>(metrics, 'frictionScore', 0)));
    const band = field<string>(metrics, 'frictionBand', 'balanced');
    const verdict = field<string>(metrics, 'frictionLabel', 'Low friction — high acceptance odds');
    const counters = field<number>(metrics, 'counterCount', 0);
    const fallbacks = field<number>(metrics, 'fallbackCount', 0);
    const pinX = Math.max(5, Math.min(275, (score / 100) * 280));

    return html`
      <div
        class="rl-lev"
        data-testid="leverage-gauge"
        data-friction=${String(score)}
        data-band=${band}
      >
        <div class="rl-lev__hdr">
          <span class="rl-lev__lbl">${props.label ?? 'Deal Friction & Odds'}</span>
          <span class="rl-lev__score">${score}/100 · ${counters}C / ${fallbacks}F</span>
        </div>
        <div class=${`rl-lev__verdict rl-lev__verdict--${band}`} data-testid="leverage-verdict">
          ${verdict}
        </div>
        <svg class="rl-lev__svg" viewBox="0 0 320 14" aria-hidden="true">
          ${svg`
            <rect x="0" y="5" width="118" height="5" rx="2.5" fill="var(--rl-good-soft)" stroke="var(--rl-good)" stroke-width="0.8" />
            <rect x="122" y="5" width="108" height="5" rx="2.5" fill="var(--rl-primary-soft)" stroke="var(--rl-primary)" stroke-width="0.8" />
            <rect x="234" y="5" width="86" height="5" rx="2.5" fill="var(--rl-danger-soft)" stroke="var(--rl-danger)" stroke-width="0.8" />
            <polygon points="${(pinX / 280) * 320},13 ${(pinX / 280) * 320 - 4.5},2.5 ${(pinX / 280) * 320 + 4.5},2.5" fill="var(--rl-text)" />
          `}
        </svg>
      </div>
    `;
  }
}

export const A2uiLeverageGauge = {
  ...LeverageGaugeApi,
  tagName: A2uiLeverageGaugeElement.tagName,
  element: A2uiLeverageGaugeElement,
};
