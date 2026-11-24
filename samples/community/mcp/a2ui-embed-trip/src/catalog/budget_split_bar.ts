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
 * `BudgetSplitBar`: stacked category spend bar (`stay`, `food`, `tickets`, `transit`)
 * bound to `@call: tripStats(...)` and writable `/budgetCap`.
 */

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  type ComponentApi,
  DynamicNumberSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import {parseTripStats} from './model.js';

export const BudgetSplitBarApi = {
  name: 'BudgetSplitBar',
  schema: spec(
    z
      .object({
        stats: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Live tripStats object with totalCost and category breakdown.',
        ),
        budgetCap: DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Writable total budget cap bound to /budgetCap.',
        ),
      })
      .describe('Stacked category budget bar comparing live tripStats spend against budgetCap.')
      .strict(),
    {mixins: [], required: ['stats', 'budgetCap']},
  ),
} satisfies ComponentApi;

const SEGMENTS = [
  {key: 'stay' as const, label: 'Stay', cls: 'stay'},
  {key: 'food' as const, label: 'Food', cls: 'food'},
  {key: 'tickets' as const, label: 'Tickets', cls: 'tickets'},
  {key: 'transit' as const, label: 'Transit', cls: 'transit'},
];

/**
 * @cssprop [--a2ui-budgetbar-bg=var(--color-background-secondary)] - Budget container fill.
 */
export class A2uiBudgetSplitBarElement extends A2uiLitElement<typeof BudgetSplitBarApi> {
  static readonly tagName = 'a2ui-trip-budget-split-bar';

  static override styles = css`
    :host {
      display: block;
    }
    .ts-budget {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 9px;
      background: var(
        --a2ui-budgetbar-bg,
        var(--color-background-secondary, var(--a2ui-color-surface, light-dark(#f6f8fc, #26282b)))
      );
      border: 1px solid var(--color-border-primary, light-dark(#e0e4eb, #383b3f));
    }
    .ts-budget__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .ts-budget__totals {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }
    .ts-budget__spent {
      font-size: 14px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    .ts-budget__cap {
      font-size: 11.5px;
      color: var(--color-text-secondary, light-dark(#5f6368, #9aa0a6));
      font-variant-numeric: tabular-nums;
    }
    .ts-budget__delta {
      font-size: 11px;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 999px;
      background: light-dark(#dcfce7, #1b3b28);
      color: light-dark(#15803d, #86efac);
    }
    .ts-budget__delta--over {
      background: light-dark(#fee2e2, #451a1a);
      color: light-dark(#b91c1c, #fca5a5);
    }
    .ts-budget__cap-ctrls {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .ts-budget__btn {
      padding: 1px 6px;
      border-radius: 5px;
      border: 1px solid var(--color-border-primary, light-dark(#cbd5e1, #475569));
      background: var(--color-background-primary, light-dark(#ffffff, #1e2024));
      color: inherit;
      font: inherit;
      font-size: 10.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .ts-budget__track {
      display: flex;
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
      background: light-dark(#e2e8f0, #343840);
      gap: 1px;
    }
    .ts-budget__seg--stay {
      background: #7c3aed;
    }
    .ts-budget__seg--food {
      background: #f59e0b;
    }
    .ts-budget__seg--tickets {
      background: #0d9488;
    }
    .ts-budget__seg--transit {
      background: #3b82f6;
    }
    .ts-budget__legend {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 10.5px;
      color: var(--color-text-secondary, light-dark(#475569, #9ca3af));
    }
    .ts-budget__item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-variant-numeric: tabular-nums;
    }
    .ts-budget__dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
  `;

  protected override readonly api = BudgetSplitBarApi;

  private adjustCap(currentCap: number, delta: number): void {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    const setter = props?.['setBudgetCap'];
    if (typeof setter === 'function') {
      (setter as (next: number) => void)(Math.max(100, currentCap + delta));
    }
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const stats = parseTripStats(props['stats']);
    if (!stats) return nothing;
    const cap =
      typeof props['budgetCap'] === 'number' && props['budgetCap'] > 0
        ? props['budgetCap']
        : stats.budgetCap;
    const scale = Math.max(cap, stats.totalCost, 1);
    const diff = cap - stats.totalCost;
    const over = diff < 0;

    return html`
      <div class="ts-budget" role="region" aria-label="Trip budget breakdown">
        <div class="ts-budget__head">
          <div class="ts-budget__totals">
            <span class="ts-budget__spent">$${stats.totalCost}</span>
            <span class="ts-budget__cap">of $${cap} cap</span>
            <span class="ts-budget__delta ${over ? 'ts-budget__delta--over' : ''}">
              ${over ? `$${Math.abs(diff)} over cap` : `$${diff} under cap`}
            </span>
          </div>
          <div class="ts-budget__cap-ctrls">
            <button
              type="button"
              class="ts-budget__btn"
              aria-label="Decrease budget cap by $25"
              @click=${() => this.adjustCap(cap, -25)}
            >
              Cap -$25
            </button>
            <button
              type="button"
              class="ts-budget__btn"
              aria-label="Increase budget cap by $25"
              @click=${() => this.adjustCap(cap, 25)}
            >
              Cap +$25
            </button>
          </div>
        </div>
        <div class="ts-budget__track" aria-hidden="true">
          ${SEGMENTS.map(seg => {
            const amount = stats.categories[seg.key];
            if (amount <= 0) return nothing;
            const widthPct = (amount / scale) * 100;
            return html`<div
              class="ts-budget__seg--${seg.cls}"
              style="width:${widthPct.toFixed(1)}%"
            ></div>`;
          })}
        </div>
        <div class="ts-budget__legend">
          ${SEGMENTS.map(seg => {
            const amount = stats.categories[seg.key];
            if (amount <= 0 && seg.key === 'stay') return nothing;
            return html`
              <span class="ts-budget__item">
                <span class="ts-budget__dot ts-budget__seg--${seg.cls}"></span>
                ${seg.label} $${amount}
              </span>
            `;
          })}
        </div>
      </div>
    `;
  }
}

export const A2uiBudgetSplitBar = {
  ...BudgetSplitBarApi,
  tagName: A2uiBudgetSplitBarElement.tagName,
  element: A2uiBudgetSplitBarElement,
};
