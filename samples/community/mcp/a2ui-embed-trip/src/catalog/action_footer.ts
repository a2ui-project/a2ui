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
 * `ActionFooter`: dispatches server actions (`lock_itinerary`, `rain_reschedule`)
 * and chat follow-ups (`ask_local_spots`) alongside live status notes.
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

export const ActionFooterApi = {
  name: 'ActionFooter',
  schema: spec(
    z
      .object({
        status: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Live status line shown beside the action buttons.',
        ).optional(),
        lockLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Label for the primary lock itinerary button.',
        ).optional(),
        lockAction: ActionSchema.describe(
          'REF:#/$defs/Action|Primary action confirming and locking the current itinerary.',
        ),
        rainLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Label for the optional rain reschedule action button.',
        ).optional(),
        rainAction: ActionSchema.describe(
          'REF:#/$defs/Action|Optional action swapping exposed afternoon stops to indoor backups.',
        ).optional(),
        followUpLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Label for the chat follow-up button.',
        ).optional(),
        followUpAction: ActionSchema.describe(
          'REF:#/$defs/Action|Optional follow-up action posting a local-spots prompt to chat.',
        ).optional(),
      })
      .describe('Action bar for locking the itinerary, rain-rescheduling, or asking in chat.')
      .strict(),
    {mixins: [], required: ['lockAction']},
  ),
} satisfies ComponentApi;

/**
 * @cssprop [--a2ui-actionfooter-primary-bg=var(--color-ring-primary)] - Primary button fill.
 */
export class A2uiActionFooterElement extends A2uiLitElement<typeof ActionFooterApi> {
  static readonly tagName = 'a2ui-trip-action-footer';

  static override styles = css`
    :host {
      display: block;
    }
    .ts-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .ts-footer__status {
      font-size: 11.5px;
      color: var(--color-text-secondary, light-dark(#5f6368, #9aa0a6));
      flex: 1;
      min-width: 140px;
    }
    .ts-footer__actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .ts-footer__btn {
      padding: 5px 11px;
      border-radius: 7px;
      font: inherit;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--color-border-primary, light-dark(#cbd5e1, #475569));
      background: var(--color-background-secondary, light-dark(#f8fafc, #282c34));
      color: var(--color-text-primary, light-dark(#1f2937, #e5e7eb));
    }
    .ts-footer__btn--ghost {
      background: transparent;
      color: var(--color-ring-primary, light-dark(#1d4ed8, #93c5fd));
      border-color: transparent;
    }
    .ts-footer__btn--ghost:hover {
      background: light-dark(#eff6ff, #1e293b);
    }
    .ts-footer__btn--primary {
      background: var(
        --a2ui-actionfooter-primary-bg,
        var(--color-ring-primary, light-dark(#1a73e8, #60a5fa))
      );
      color: light-dark(#ffffff, #0f172a);
      border-color: transparent;
    }
  `;

  protected override readonly api = ActionFooterApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const status = typeof props['status'] === 'string' ? props['status'] : '';
    const lockLabel =
      typeof props['lockLabel'] === 'string' ? props['lockLabel'] : 'Lock itinerary';
    const rainLabel =
      typeof props['rainLabel'] === 'string' ? props['rainLabel'] : 'Rain reschedule';
    const followUpLabel =
      typeof props['followUpLabel'] === 'string' ? props['followUpLabel'] : 'Ask local spots';

    const lockFn = props['lockAction'];
    const rainFn = props['rainAction'];
    const followUpFn = props['followUpAction'];

    return html`
      <div class="ts-footer">
        <span class="ts-footer__status">${status}</span>
        <div class="ts-footer__actions">
          ${typeof followUpFn === 'function'
            ? html`
                <button
                  type="button"
                  class="ts-footer__btn ts-footer__btn--ghost"
                  @click=${() => (followUpFn as () => void)()}
                >
                  ${followUpLabel}
                </button>
              `
            : nothing}
          ${typeof rainFn === 'function'
            ? html`
                <button
                  type="button"
                  class="ts-footer__btn"
                  @click=${() => (rainFn as () => void)()}
                >
                  ${rainLabel}
                </button>
              `
            : nothing}
          <button
            type="button"
            class="ts-footer__btn ts-footer__btn--primary"
            @click=${() => {
              if (typeof lockFn === 'function') (lockFn as () => void)();
            }}
          >
            ${lockLabel}
          </button>
        </div>
      </div>
    `;
  }
}

export const A2uiActionFooter = {
  ...ActionFooterApi,
  tagName: A2uiActionFooterElement.tagName,
  element: A2uiActionFooterElement,
};
