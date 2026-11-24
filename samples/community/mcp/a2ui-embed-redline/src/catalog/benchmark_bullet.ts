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
 * `BenchmarkBullet`: inline SVG range/bullet bar comparing a quoted deposit,
 * fee, or line-item rate against local statutory or market norms.
 */

import {css, html, nothing, svg} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  DynamicNumberSchema,
  DynamicStringSchema,
  spec,
  type ComponentApi,
} from '@a2ui/web_core/v1_0';

import {REDLINE_TOKENS} from './theme_tokens.js';

export const BenchmarkBulletApi = {
  name: 'BenchmarkBullet',
  schema: spec(
    z
      .object({
        label: DynamicStringSchema.describe('REF:#/$defs/DynamicString|Benchmark metric name.'),
        min: DynamicNumberSchema.describe('REF:#/$defs/DynamicNumber|Minimum scale value.'),
        max: DynamicNumberSchema.describe('REF:#/$defs/DynamicNumber|Maximum scale value.'),
        normLow: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Lower bound of the local/market norm band.',
        ),
        normHigh: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Upper bound of the local/market norm band.',
        ),
        normLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Short label for the market norm band, such as "1.0 mo norm".',
        ),
        theirs: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Counterparty quoted figure on the same scale.',
        ),
        theirsLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Short label for their pin, such as "2.5 mo theirs".',
        ),
        ours: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Optional recommended counter figure.',
        ).optional(),
        oursLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional label for our counter pin.',
        ).optional(),
      })
      .describe('SVG bullet bar contrasting counterparty figures against local/market norms.')
      .strict(),
    {
      mixins: [],
      required: [
        'label',
        'min',
        'max',
        'normLow',
        'normHigh',
        'normLabel',
        'theirs',
        'theirsLabel',
      ],
    },
  ),
} satisfies ComponentApi;

function pct(val: number, min: number, max: number): number {
  const span = max > min ? max - min : 1;
  return Math.max(2, Math.min(98, ((val - min) / span) * 100));
}

export class A2uiBenchmarkBulletElement extends A2uiLitElement<typeof BenchmarkBulletApi> {
  static readonly tagName = 'a2ui-redline-benchmark';

  static override styles = [
    REDLINE_TOKENS,
    css`
      :host {
        display: block;
      }
      .rl-bench {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px 7px;
        border-radius: 6px;
        background: var(--rl-bg);
        border: 1px solid var(--rl-border);
      }
      .rl-bench__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        flex-wrap: wrap;
      }
      .rl-bench__lbl {
        font-size: 10.5px;
        font-weight: 600;
        color: var(--rl-text);
      }
      .rl-bench__tags {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 10px;
        font-weight: 600;
      }
      .rl-bench__tag-norm {
        color: var(--rl-good);
      }
      .rl-bench__tag-ours {
        color: var(--rl-primary);
      }
      .rl-bench__tag-theirs {
        color: var(--rl-danger);
      }
      .rl-bench__svg {
        display: block;
        width: 100%;
        height: 14px;
      }
    `,
  ];

  protected override readonly api = BenchmarkBulletApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const min = Number(props.min ?? 0);
    const max = Number(props.max ?? 100);
    const normStart = pct(Number(props.normLow ?? min), min, max) * 5.6;
    const normEnd = pct(Number(props.normHigh ?? min), min, max) * 5.6;
    const normWidth = Math.max(12, normEnd - normStart);
    const theirsX = pct(Number(props.theirs ?? min), min, max) * 5.6;
    const hasOurs = typeof props.ours === 'number' && Number.isFinite(props.ours);
    const oursX = hasOurs ? pct(Number(props.ours), min, max) * 5.6 : 0;

    return html`
      <div
        class="rl-bench"
        role="img"
        aria-label=${`${String(props.label)}: ${String(props.normLabel)} vs ${String(props.theirsLabel)}`}
      >
        <div class="rl-bench__row">
          <span class="rl-bench__lbl">${props.label}</span>
          <span class="rl-bench__tags">
            <span class="rl-bench__tag-norm">▮ ${props.normLabel}</span>
            ${props.oursLabel
              ? html`<span class="rl-bench__tag-ours">◆ ${props.oursLabel}</span>`
              : nothing}
            <span class="rl-bench__tag-theirs">● ${props.theirsLabel}</span>
          </span>
        </div>
        <svg class="rl-bench__svg" viewBox="0 0 560 14">
          ${svg`
            <rect x="0" y="5" width="560" height="4" rx="2" fill="var(--rl-surface-raised)" />
            <rect x="${normStart}" y="3" width="${normWidth}" height="8" rx="3" fill="var(--rl-good-soft)" stroke="var(--rl-good)" stroke-width="1.1" />
            ${
              hasOurs
                ? svg`<polygon points="${oursX},2 ${oursX + 4.5},7 ${oursX},12 ${oursX - 4.5},7" fill="var(--rl-primary)" />`
                : nothing
            }
            <line x1="${theirsX}" y1="1" x2="${theirsX}" y2="13" stroke="var(--rl-danger)" stroke-width="2" />
            <circle cx="${theirsX}" cy="7" r="3.6" fill="var(--rl-danger)" />
          `}
        </svg>
      </div>
    `;
  }
}

export const A2uiBenchmarkBullet = {
  ...BenchmarkBulletApi,
  tagName: A2uiBenchmarkBulletElement.tagName,
  element: A2uiBenchmarkBulletElement,
};
