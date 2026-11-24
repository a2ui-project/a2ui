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
 * `ExposureMeter`: live worst-case dollar downside bar bound to
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

import {formatDollars} from './functions.js';
import {REDLINE_TOKENS} from './theme_tokens.js';

export const ExposureMeterApi = {
  name: 'ExposureMeter',
  schema: spec(
    z
      .object({
        label: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional heading label for the exposure meter.',
        ).optional(),
        metrics: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Live metrics object from @call: negotiationMetrics(/clauses, /stances).',
        ),
      })
      .describe(
        'Visual dollar-at-risk downside bar that drops live as clauses flip from accept to counter.',
      )
      .strict(),
    {mixins: [], required: ['metrics']},
  ),
} satisfies ComponentApi;

function numField(obj: unknown, key: string, fallback = 0): number {
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
  }
  return fallback;
}

export class A2uiExposureMeterElement extends A2uiLitElement<typeof ExposureMeterApi> {
  static readonly tagName = 'a2ui-redline-exposure';

  static override styles = [
    REDLINE_TOKENS,
    css`
      :host {
        display: block;
      }
      .rl-exp {
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
      .rl-exp__hdr {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
      }
      .rl-exp__lbl {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--rl-muted);
      }
      .rl-exp__saved {
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        background: var(--rl-good-soft);
        color: var(--rl-good);
      }
      .rl-exp__val-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .rl-exp__val {
        font-size: 16px;
        font-weight: 750;
        letter-spacing: -0.02em;
        color: var(--rl-text);
      }
      .rl-exp__max {
        font-size: 10.5px;
        color: var(--rl-muted);
      }
      .rl-exp__svg {
        display: block;
        width: 100%;
        height: 12px;
      }
    `,
  ];

  protected override readonly api = ExposureMeterApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const metrics = props.metrics;
    const current = numField(metrics, 'currentExposure');
    const max = Math.max(1, numField(metrics, 'maxExposure', 1));
    const min = numField(metrics, 'minExposure');
    const saved = numField(metrics, 'savedDollars');
    const fillWidth = Math.max(4, Math.min(280, (current / max) * 280));
    const minX = Math.max(2, Math.min(278, (min / max) * 280));
    const barColor =
      current <= min + (max - min) * 0.28
        ? 'var(--rl-good)'
        : current <= min + (max - min) * 0.65
          ? 'var(--rl-warn)'
          : 'var(--rl-danger)';

    return html`
      <div class="rl-exp" data-testid="exposure-meter" data-exposure=${String(current)}>
        <div class="rl-exp__hdr">
          <span class="rl-exp__lbl">${props.label ?? 'Downside Exposure'}</span>
          ${saved > 0
            ? html`<span class="rl-exp__saved" data-testid="exposure-saved"
                >−${formatDollars(saved)} cut</span
              >`
            : html`<span class="rl-exp__max">No risk cut yet</span>`}
        </div>
        <div class="rl-exp__val-row">
          <span class="rl-exp__val" data-testid="exposure-current">${formatDollars(current)}</span>
          <span class="rl-exp__max"
            >at risk (signing as-is: ${formatDollars(max)} · floor: ${formatDollars(min)})</span
          >
        </div>
        <svg class="rl-exp__svg" viewBox="0 0 280 12" preserveAspectRatio="none" aria-hidden="true">
          ${svg`
            <rect x="0" y="2" width="280" height="8" rx="4" fill="var(--rl-danger-soft)" />
            <rect x="0" y="2" width="${fillWidth}" height="8" rx="4" fill="${barColor}" />
            <line x1="${minX}" y1="0" x2="${minX}" y2="12" stroke="var(--rl-primary)" stroke-width="1.8" />
          `}
        </svg>
      </div>
    `;
  }
}

export const A2uiExposureMeter = {
  ...ExposureMeterApi,
  tagName: A2uiExposureMeterElement.tagName,
  element: A2uiExposureMeterElement,
};
