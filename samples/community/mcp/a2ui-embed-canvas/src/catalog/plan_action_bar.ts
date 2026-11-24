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

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  ActionSchema,
  type ComponentApi,
  DynamicStringSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import {CANVAS_THEME_VARS} from './styles.js';

export const PlanActionBarApi = {
  name: 'PlanActionBar',
  schema: spec(
    z
      .object({
        primaryLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Primary button label (e.g. Save layout).',
        ),
        primaryAction: ActionSchema.describe(
          'REF:#/$defs/Action|Primary server action saving the current layout.',
        ),
        resolveLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional auto-resolve button label.',
        ).optional(),
        resolveAction: ActionSchema.describe(
          'REF:#/$defs/Action|Optional server action resolving spatial or seating conflicts.',
        ).optional(),
        followUpLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional chat follow-up button label.',
        ).optional(),
        followUpAction: ActionSchema.describe(
          'REF:#/$defs/Action|Optional follow-up action posting a question to chat.',
        ).optional(),
        savedNote: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional status note shown after saving or resolving.',
        ).optional(),
      })
      .describe('Footer action bar dispatching layout actions and follow-up prompts.')
      .strict(),
    {mixins: [], required: ['primaryLabel', 'primaryAction']},
  ),
} satisfies ComponentApi;

/**
 * Footer action bar for saving layouts, auto-resolving conflicts, and asking
 * ergonomics or hosting follow-ups in chat.
 *
 * @cssprop [--a2ui-plan-action-bar-gap=8px] - Gap between action buttons.
 */
export class A2uiPlanActionBarElement extends A2uiLitElement<typeof PlanActionBarApi> {
  static readonly tagName = 'a2ui-canvas-plan-action-bar';

  static override styles = [
    CANVAS_THEME_VARS,
    css`
      :host {
        display: block;
      }
      .ab-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--a2ui-plan-action-bar-gap, 8px);
      }
      .ab-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
      }
      .ab-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 11px;
        border-radius: 8px;
        border: 1px solid var(--cs-border);
        background: var(--cs-surface);
        color: var(--cs-text);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.3;
        cursor: pointer;
      }
      .ab-btn:hover {
        border-color: var(--cs-accent);
      }
      .ab-btn-primary {
        background: var(--cs-accent);
        border-color: var(--cs-accent);
        color: light-dark(#ffffff, #101418);
      }
      .ab-btn-primary:hover {
        filter: brightness(1.06);
      }
      .ab-btn-ghost {
        background: transparent;
        border-style: dashed;
        font-weight: 550;
      }
      .ab-note {
        font-size: 11.5px;
        color: var(--cs-pass-fg);
        font-weight: 600;
      }
    `,
  ];

  protected override readonly api = PlanActionBarApi;

  override render() {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    if (!props) return nothing;

    const primaryLabel =
      typeof props['primaryLabel'] === 'string' ? props['primaryLabel'] : 'Save layout';
    const primaryAction = props['primaryAction'] as (() => void) | undefined;
    const resolveLabel = typeof props['resolveLabel'] === 'string' ? props['resolveLabel'] : '';
    const resolveAction = props['resolveAction'] as (() => void) | undefined;
    const followUpLabel = typeof props['followUpLabel'] === 'string' ? props['followUpLabel'] : '';
    const followUpAction = props['followUpAction'] as (() => void) | undefined;
    const savedNote = typeof props['savedNote'] === 'string' ? props['savedNote'] : '';

    return html`
      <div class="ab-row">
        <div class="ab-actions">
          <button type="button" class="ab-btn ab-btn-primary" @click=${() => primaryAction?.()}>
            ${primaryLabel}
          </button>
          ${resolveLabel && resolveAction
            ? html`
                <button type="button" class="ab-btn" @click=${() => resolveAction()}>
                  ${resolveLabel}
                </button>
              `
            : nothing}
          ${followUpLabel && followUpAction
            ? html`
                <button type="button" class="ab-btn ab-btn-ghost" @click=${() => followUpAction()}>
                  ${followUpLabel}
                </button>
              `
            : nothing}
        </div>
        ${savedNote ? html`<span class="ab-note" role="status">${savedNote}</span>` : nothing}
      </div>
    `;
  }
}

export const A2uiPlanActionBar = {
  ...PlanActionBarApi,
  tagName: A2uiPlanActionBarElement.tagName,
  element: A2uiPlanActionBarElement,
};
