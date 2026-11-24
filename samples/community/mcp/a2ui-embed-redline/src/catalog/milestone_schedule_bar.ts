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
 * `MilestoneScheduleBar`: side-by-side proportional SVG payment-schedule bar
 * comparing a front-loaded counterparty schedule against a milestone-gated holdback.
 */

import {css, html, nothing, svg} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  DynamicNumberSchema,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
  type ComponentApi,
} from '@a2ui/web_core/v1_0';

import {formatDollars} from './functions.js';
import {REDLINE_TOKENS} from './theme_tokens.js';
import type {MilestoneSegment} from './types.js';

export const MilestoneScheduleBarApi = {
  name: 'MilestoneScheduleBar',
  schema: spec(
    z
      .object({
        title: DynamicStringSchema.describe('REF:#/$defs/DynamicString|Schedule comparison title.'),
        totalAmount: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Total quote or contract value in dollars.',
        ),
        activeStance: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional stance binding to highlight active schedule.',
        ).optional(),
        theirsMilestones: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Array of {label, percent} segments in counterparty schedule.',
        ),
        recommendedMilestones: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Array of {label, percent} segments in recommended milestone schedule.',
        ),
      })
      .describe('Visual payment-schedule milestone bar for contractor quotes and SOW contracts.')
      .strict(),
    {
      mixins: [],
      required: ['title', 'totalAmount', 'theirsMilestones', 'recommendedMilestones'],
    },
  ),
} satisfies ComponentApi;

function parseSegments(raw: unknown): MilestoneSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: MilestoneSegment[] = [];
  for (const item of raw) {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      const percent = typeof rec['percent'] === 'number' ? rec['percent'] : 0;
      const label = typeof rec['label'] === 'string' ? rec['label'] : '';
      if (percent > 0 && label) out.push({label, percent});
    }
  }
  return out;
}

const THEIRS_FILLS = ['var(--rl-danger)', 'var(--rl-warn)', 'var(--rl-muted)'];
const OURS_FILLS = ['var(--rl-primary)', 'var(--rl-good)', 'var(--rl-warn)', 'var(--rl-muted)'];

function renderSvgTrack(segments: MilestoneSegment[], fills: readonly string[]) {
  let cursor = 0;
  return svg`
    <svg class="rl-mile__svg" viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden="true">
      ${segments.map((seg, index) => {
        const width = Math.max(4, (seg.percent / 100) * 300 - 1.5);
        const x = cursor;
        cursor += (seg.percent / 100) * 300;
        const fill = fills[index % fills.length] ?? 'var(--rl-primary)';
        return svg`<rect x="${x}" y="1" width="${width}" height="10" rx="2.5" fill="${fill}" opacity="0.85" />`;
      })}
    </svg>
  `;
}

export class A2uiMilestoneScheduleBarElement extends A2uiLitElement<
  typeof MilestoneScheduleBarApi
> {
  static readonly tagName = 'a2ui-redline-milestones';

  static override styles = [
    REDLINE_TOKENS,
    css`
      :host {
        display: block;
      }
      .rl-mile {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 5px 8px;
        border: 1px solid var(--rl-border);
        border-radius: 8px;
        background: var(--rl-surface);
      }
      .rl-mile__hdr {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .rl-mile__title {
        font-size: 11.5px;
        font-weight: 650;
        color: var(--rl-text);
      }
      .rl-mile__total {
        font-size: 10.5px;
        font-weight: 700;
        font-family: var(--rl-mono);
        color: var(--rl-muted);
      }
      .rl-mile__track {
        display: grid;
        grid-template-columns: 74px 1fr;
        align-items: center;
        gap: 6px;
      }
      .rl-mile__tag {
        font-size: 10px;
        font-weight: 700;
        color: var(--rl-muted);
      }
      .rl-mile__tag--active {
        color: var(--rl-primary);
      }
      .rl-mile__bar-col {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .rl-mile__svg {
        display: block;
        width: 100%;
        height: 10px;
      }
      .rl-mile__legend {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 10px;
        color: var(--rl-muted);
      }
    `,
  ];

  protected override readonly api = MilestoneScheduleBarApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const total = Number(props.totalAmount ?? 0);
    const theirs = parseSegments(props.theirsMilestones);
    const ours = parseSegments(props.recommendedMilestones);
    const stance = typeof props.activeStance === 'string' ? props.activeStance : 'counter';

    return html`
      <div class="rl-mile" data-testid="milestone-schedule">
        <div class="rl-mile__hdr">
          <span class="rl-mile__title">${props.title}</span>
          <span class="rl-mile__total">Total ${formatDollars(total)}</span>
        </div>
        <div class="rl-mile__track">
          <span class=${`rl-mile__tag ${stance === 'accept' ? 'rl-mile__tag--active' : ''}`}
            >Theirs</span
          >
          <div class="rl-mile__bar-col">
            ${renderSvgTrack(theirs, THEIRS_FILLS)}
            <div class="rl-mile__legend">
              ${theirs.map(
                seg =>
                  html`<span
                    >${seg.percent}% ${seg.label}
                    (${formatDollars((total * seg.percent) / 100)})</span
                  >`,
              )}
            </div>
          </div>
        </div>
        <div class="rl-mile__track">
          <span class=${`rl-mile__tag ${stance !== 'accept' ? 'rl-mile__tag--active' : ''}`}
            >★ Counter</span
          >
          <div class="rl-mile__bar-col">
            ${renderSvgTrack(ours, OURS_FILLS)}
            <div class="rl-mile__legend">
              ${ours.map(
                seg =>
                  html`<span
                    >${seg.percent}% ${seg.label}
                    (${formatDollars((total * seg.percent) / 100)})</span
                  >`,
              )}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

export const A2uiMilestoneScheduleBar = {
  ...MilestoneScheduleBarApi,
  tagName: A2uiMilestoneScheduleBarElement.tagName,
  element: A2uiMilestoneScheduleBarElement,
};
