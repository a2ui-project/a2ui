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
 * `CounterLetterPreview`: live counter-offer email assembled via
 * `@call: composeCounterEmail(/docTitle, /clauses, /stances, /tone)`, with
 * `collaborative`/`firm` tone pills and action/follow-up triggers.
 */

import {css, html, nothing} from 'lit';
import {classMap} from 'lit/directives/class-map.js';
import {z} from 'zod';

import {
  A2uiLitElement,
  ActionSchema,
  DynamicStringSchema,
  spec,
  type ComponentApi,
} from '@a2ui/web_core/v1_0';

import {REDLINE_TOKENS} from './theme_tokens.js';
import {isNegotiationTone, type NegotiationTone} from './types.js';

export const CounterLetterPreviewApi = {
  name: 'CounterLetterPreview',
  schema: spec(
    z
      .object({
        title: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional heading for the live email preview.',
        ).optional(),
        tone: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Active tone bound to /tone (collaborative or firm).',
        ),
        emailBody: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Live counter-offer email body from @call: composeCounterEmail.',
        ),
        finalizeAction: ActionSchema.describe(
          'REF:#/$defs/Action|Action dispatched to lock/finalize the counter-offer.',
        ),
        resetAction: ActionSchema.describe(
          'REF:#/$defs/Action|Action dispatched to reset stances to recommended picks.',
        ),
        strategyFollowUp: ActionSchema.describe(
          'REF:#/$defs/Action|Follow-up action asking the assistant for clause negotiation strategy.',
        ),
      })
      .describe(
        'Live counter-offer email preview with collaborative/firm tone pills and action controls.',
      )
      .strict(),
    {
      mixins: [],
      required: ['tone', 'emailBody', 'finalizeAction', 'resetAction', 'strategyFollowUp'],
    },
  ),
} satisfies ComponentApi;

export class A2uiCounterLetterPreviewElement extends A2uiLitElement<
  typeof CounterLetterPreviewApi
> {
  static readonly tagName = 'a2ui-redline-letter';

  static override styles = [
    REDLINE_TOKENS,
    css`
      :host {
        display: block;
      }
      .rl-letter {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 8px;
        border: 1px solid var(--rl-border);
        border-radius: 8px;
        background: var(--rl-surface);
      }
      .rl-letter__hdr {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .rl-letter__title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--rl-muted);
      }
      .rl-letter__tones {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .rl-letter__tone {
        appearance: none;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--rl-border);
        background: var(--rl-bg);
        color: var(--rl-muted);
        font-family: inherit;
        font-size: 10.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .rl-letter__tone--active {
        background: var(--rl-primary);
        border-color: var(--rl-primary);
        color: light-dark(#ffffff, #0f172a);
      }
      .rl-letter__body {
        margin: 0;
        max-height: 62px;
        overflow-y: auto;
        padding: 5px 7px;
        border-radius: 6px;
        border: 1px solid var(--rl-border);
        background: var(--rl-bg);
        font-family: var(--rl-font);
        font-size: 11px;
        line-height: 1.32;
        white-space: pre-wrap;
        color: var(--rl-text);
      }
      .rl-letter__actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        flex-wrap: wrap;
      }
      .rl-letter__btn-group {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .rl-letter__btn {
        appearance: none;
        padding: 3px 9px;
        border-radius: 6px;
        border: 1px solid var(--rl-border);
        background: var(--rl-bg);
        color: var(--rl-text);
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .rl-letter__btn--primary {
        background: var(--rl-primary);
        border-color: var(--rl-primary);
        color: light-dark(#ffffff, #0f172a);
      }
      .rl-letter__btn--ghost {
        background: transparent;
        border-color: transparent;
        color: var(--rl-primary);
        text-decoration: underline;
        padding-inline: 6px;
      }
    `,
  ];

  protected override readonly api = CounterLetterPreviewApi;

  private selectTone(next: NegotiationTone): void {
    const props = this.controller?.props as
      | (Record<string, unknown> & {setTone?: (val: string) => void})
      | undefined;
    const setTone = props?.['setTone'];
    if (typeof setTone === 'function') {
      setTone(next);
      return;
    }
    this.context?.dataContext?.surface?.dataModel.set('/tone', next);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const activeTone: NegotiationTone = isNegotiationTone(props.tone)
      ? props.tone
      : 'collaborative';

    return html`
      <div class="rl-letter" data-testid="counter-letter">
        <div class="rl-letter__hdr">
          <span class="rl-letter__title">${props.title ?? 'Live Counter-Offer Email'}</span>
          <div class="rl-letter__tones" role="group" aria-label="Counter-offer tone">
            ${(['collaborative', 'firm'] as const).map(
              option => html`
                <button
                  type="button"
                  class=${classMap({
                    'rl-letter__tone': true,
                    'rl-letter__tone--active': activeTone === option,
                  })}
                  data-tone-pill=${option}
                  aria-pressed=${activeTone === option ? 'true' : 'false'}
                  @click=${() => this.selectTone(option)}
                >
                  ${option === 'collaborative' ? 'Collaborative' : 'Firm'}
                </button>
              `,
            )}
          </div>
        </div>
        <pre class="rl-letter__body" data-testid="counter-email-body">${props.emailBody}</pre>
        <div class="rl-letter__actions">
          <div class="rl-letter__btn-group">
            <button
              type="button"
              class="rl-letter__btn rl-letter__btn--primary"
              @click=${() => props.finalizeAction?.()}
            >
              Lock Counter-Offer
            </button>
            <button type="button" class="rl-letter__btn" @click=${() => props.resetAction?.()}>
              Reset Picks
            </button>
          </div>
          <button
            type="button"
            class="rl-letter__btn rl-letter__btn--ghost"
            @click=${() => props.strategyFollowUp?.()}
          >
            Ask Strategy in Chat
          </button>
        </div>
      </div>
    `;
  }
}

export const A2uiCounterLetterPreview = {
  ...CounterLetterPreviewApi,
  tagName: A2uiCounterLetterPreviewElement.tagName,
  element: A2uiCounterLetterPreviewElement,
};
