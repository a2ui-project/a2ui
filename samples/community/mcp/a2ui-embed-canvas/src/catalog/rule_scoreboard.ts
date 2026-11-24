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

import {css, html, nothing, svg} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  type ComponentApi,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import type {PlanEvaluation, RuleStatus} from '../domain/types.js';
import {CANVAS_THEME_VARS} from './styles.js';

export const RuleScoreboardApi = {
  name: 'RuleScoreboard',
  schema: spec(
    z
      .object({
        evaluation: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Structured constraint evaluation from evaluatePlan.',
        ),
        selectedId: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional two-way bound selection ID focused when clicking a rule pill.',
        ).optional(),
      })
      .describe(
        'Live spatial and social constraint pills that update green, amber, or red mid-drag.',
      )
      .strict(),
    {mixins: [], required: ['evaluation']},
  ),
} satisfies ComponentApi;

function statusIcon(status: RuleStatus) {
  if (status === 'pass') {
    return svg`<path d="M3 7.3L5.6 10L11 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (status === 'warn') {
    return svg`<path d="M7 3.5V7.5M7 10.2H7.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;
  }
  return svg`<path d="M4.2 4.2L9.8 9.8M9.8 4.2L4.2 9.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;
}

/**
 * Live spatial/social constraint pills bound to `@call: evaluatePlan(...)`.
 *
 * @cssprop [--a2ui-rule-scoreboard-gap=6px] - Gap between constraint pills.
 */
export class A2uiRuleScoreboardElement extends A2uiLitElement<typeof RuleScoreboardApi> {
  static readonly tagName = 'a2ui-canvas-rule-scoreboard';

  static override styles = [
    CANVAS_THEME_VARS,
    css`
      :host {
        display: block;
      }
      .rs-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: var(--a2ui-rule-scoreboard-gap, 6px);
        align-items: center;
      }
      .rs-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 8px;
        border-radius: 7px;
        border: 1px solid var(--cs-border);
        background: var(--cs-surface);
        color: var(--cs-text);
        font: inherit;
        font-size: 11.5px;
        line-height: 1.25;
        cursor: pointer;
        transition: transform 0.08s ease;
      }
      .rs-pill:hover {
        filter: brightness(0.98);
      }
      .rs-pill[data-status='pass'] {
        background: var(--cs-pass-bg);
        border-color: var(--cs-pass-border);
        color: var(--cs-pass-fg);
      }
      .rs-pill[data-status='warn'] {
        background: var(--cs-warn-bg);
        border-color: var(--cs-warn-border);
        color: var(--cs-warn-fg);
      }
      .rs-pill[data-status='fail'] {
        background: var(--cs-fail-bg);
        border-color: var(--cs-fail-border);
        color: var(--cs-fail-fg);
      }
      .rs-icon {
        width: 13px;
        height: 13px;
        flex-shrink: 0;
      }
      .rs-name {
        font-weight: 600;
      }
      .rs-detail {
        opacity: 0.86;
        font-weight: 450;
      }
    `,
  ];

  protected override readonly api = RuleScoreboardApi;

  override render() {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    if (!props) return nothing;
    const raw = props['evaluation'];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return nothing;
    const evaluation = raw as unknown as PlanEvaluation;
    const results = Array.isArray(evaluation.results) ? evaluation.results : [];
    const setSelectedId = props['setSelectedId'] as ((val: string) => void) | undefined;

    return html`
      <div class="rs-wrap" role="region" aria-label="Live constraint scoreboard">
        ${results.map(
          rule => html`
            <button
              type="button"
              class="rs-pill"
              data-rule-id=${rule.id}
              data-status=${rule.status}
              @click=${() => {
                if (rule.focusId && setSelectedId) {
                  setSelectedId(rule.focusId);
                }
              }}
            >
              <svg class="rs-icon" viewBox="0 0 14 14" aria-hidden="true">
                ${statusIcon(rule.status)}
              </svg>
              <span class="rs-name">${rule.label}</span>
              <span class="rs-detail">· ${rule.detail}</span>
            </button>
          `,
        )}
      </div>
    `;
  }
}

export const A2uiRuleScoreboard = {
  ...RuleScoreboardApi,
  tagName: A2uiRuleScoreboardElement.tagName,
  element: A2uiRuleScoreboardElement,
};
