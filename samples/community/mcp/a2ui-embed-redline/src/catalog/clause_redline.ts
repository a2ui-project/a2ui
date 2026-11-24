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
 * `ClauseRedline`: tracked-changes inline diff block with live stance pills
 * (`accept` / `counter` / `fallback`) writing `/stances/<clauseId>` and an
 * optional slotted `evidenceChild` (such as `BenchmarkBullet`).
 */

import {css, html, nothing} from 'lit';
import {classMap} from 'lit/directives/class-map.js';
import {z} from 'zod';

import {
  A2uiLitElement,
  ChildSchema,
  DynamicStringSchema,
  spec,
  type ComponentApi,
} from '@a2ui/web_core/v1_0';

import {REDLINE_TOKENS} from './theme_tokens.js';
import {isStance, STANCES, type Stance} from './types.js';

export const ClauseRedlineApi = {
  name: 'ClauseRedline',
  schema: spec(
    z
      .object({
        clauseId: z.string().min(1).describe('Stable clause key matching /stances/<clauseId>.'),
        section: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional contract section tag such as §4.',
        ).optional(),
        title: DynamicStringSchema.describe('REF:#/$defs/DynamicString|Clause heading.'),
        riskBadge: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional dollar-risk or severity chip.',
        ).optional(),
        theirsText: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Original counterparty clause wording.',
        ),
        counterText: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Recommended counter-proposal wording.',
        ),
        fallbackText: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Soft compromise fallback wording.',
        ),
        rationale: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional concise market or legal rationale.',
        ).optional(),
        recommended: z
          .enum(STANCES)
          .describe('Which stance carries the ★ recommendation star.')
          .optional(),
        stance: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Active stance bound to /stances/<clauseId>.',
        ),
        evidenceChild: ChildSchema.describe(
          'REF:#/$defs/Child|Optional slotted evidence child such as BenchmarkBullet.',
        ).optional(),
      })
      .describe(
        'Tracked-changes clause diff card with live accept/counter/fallback pills and optional evidence slot.',
      )
      .strict(),
    {
      mixins: [],
      required: ['clauseId', 'title', 'theirsText', 'counterText', 'fallbackText', 'stance'],
    },
  ),
} satisfies ComponentApi;

const PILL_LABELS: Record<Stance, string> = {
  counter: 'Counter',
  fallback: 'Fallback',
  accept: 'Accept',
};

export class A2uiClauseRedlineElement extends A2uiLitElement<typeof ClauseRedlineApi> {
  static readonly tagName = 'a2ui-redline-clause';

  static override styles = [
    REDLINE_TOKENS,
    css`
      :host {
        display: block;
      }
      .rl-clause {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 5px 8px;
        border: 1px solid var(--rl-border);
        border-radius: 8px;
        background: var(--rl-surface);
      }
      .rl-clause--counter {
        border-left: 3px solid var(--rl-primary);
      }
      .rl-clause--fallback {
        border-left: 3px solid var(--rl-warn);
      }
      .rl-clause--accept {
        border-left: 3px solid var(--rl-border);
      }
      .rl-clause__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        flex-wrap: wrap;
      }
      .rl-clause__heading {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
      }
      .rl-clause__sec {
        padding: 1px 5px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        font-family: var(--rl-mono);
        background: var(--rl-surface-raised);
        color: var(--rl-muted);
      }
      .rl-clause__title {
        font-size: 12px;
        font-weight: 650;
        color: var(--rl-text);
      }
      .rl-clause__risk {
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 600;
        background: var(--rl-danger-soft);
        color: var(--rl-danger);
      }
      .rl-clause__pills {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .rl-clause__pill {
        appearance: none;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid var(--rl-border);
        background: var(--rl-bg);
        color: var(--rl-muted);
        font-family: inherit;
        font-size: 10.5px;
        font-weight: 600;
        line-height: 1.3;
        cursor: pointer;
      }
      .rl-clause__pill--active-counter {
        background: var(--rl-primary);
        border-color: var(--rl-primary);
        color: light-dark(#ffffff, #0f172a);
      }
      .rl-clause__pill--active-fallback {
        background: var(--rl-warn);
        border-color: var(--rl-warn);
        color: light-dark(#ffffff, #181c20);
      }
      .rl-clause__pill--active-accept {
        background: var(--rl-surface-raised);
        border-color: var(--rl-text);
        color: var(--rl-text);
      }
      .rl-clause__diff {
        font-size: 11.5px;
        line-height: 1.35;
        color: var(--rl-text);
      }
      .rl-clause__del {
        text-decoration: line-through;
        text-decoration-thickness: 1.3px;
        color: var(--rl-danger);
        background: var(--rl-danger-soft);
        padding: 0 3px;
        border-radius: 3px;
        margin-right: 4px;
      }
      .rl-clause__ins {
        text-decoration: none;
        font-weight: 550;
        padding: 0 4px;
        border-radius: 3px;
      }
      .rl-clause__ins--counter {
        color: var(--rl-good);
        background: var(--rl-good-soft);
      }
      .rl-clause__ins--fallback {
        color: var(--rl-warn);
        background: var(--rl-warn-soft);
      }
      .rl-clause__keep {
        color: var(--rl-text);
      }
      .rl-clause__keep-tag {
        margin-left: 5px;
        font-size: 10px;
        font-weight: 600;
        color: var(--rl-muted);
      }
      .rl-clause__why {
        font-size: 10.5px;
        line-height: 1.25;
        color: var(--rl-muted);
      }
      .rl-clause__evidence {
        margin-top: 2px;
        padding-top: 4px;
        border-top: 1px dashed var(--rl-border);
      }
    `,
  ];

  protected override readonly api = ClauseRedlineApi;

  private selectStance(next: Stance): void {
    const props = this.controller?.props as
      | (Record<string, unknown> & {clauseId?: string; setStance?: (val: string) => void})
      | undefined;
    if (!props) return;
    const setStance = props['setStance'];
    if (typeof setStance === 'function') {
      setStance(next);
      return;
    }
    const clauseId = props['clauseId'];
    if (typeof clauseId === 'string' && clauseId) {
      this.context?.dataContext?.surface?.dataModel.set(`/stances/${clauseId}`, next);
    }
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const active: Stance = isStance(props.stance) ? props.stance : 'counter';
    const recommended: Stance = isStance(props.recommended) ? props.recommended : 'counter';
    const pillOrder: readonly Stance[] = ['counter', 'fallback', 'accept'];

    return html`
      <article
        class=${classMap({
          'rl-clause': true,
          [`rl-clause--${active}`]: true,
        })}
        data-clause-id=${props.clauseId}
        data-active-stance=${active}
      >
        <div class="rl-clause__top">
          <div class="rl-clause__heading">
            ${props.section ? html`<span class="rl-clause__sec">${props.section}</span>` : nothing}
            <span class="rl-clause__title">${props.title}</span>
            ${props.riskBadge
              ? html`<span class="rl-clause__risk">${props.riskBadge}</span>`
              : nothing}
          </div>
          <div
            class="rl-clause__pills"
            role="group"
            aria-label=${`Stance for ${String(props.title)}`}
          >
            ${pillOrder.map(option => {
              const isRec = option === recommended;
              const isActive = option === active;
              const label = `${isRec ? '★ ' : ''}${PILL_LABELS[option]}`;
              return html`
                <button
                  type="button"
                  class=${classMap({
                    'rl-clause__pill': true,
                    [`rl-clause__pill--active-${option}`]: isActive,
                  })}
                  data-stance-pill=${option}
                  aria-pressed=${isActive ? 'true' : 'false'}
                  @click=${() => this.selectStance(option)}
                >
                  ${label}
                </button>
              `;
            })}
          </div>
        </div>

        <div class="rl-clause__diff" data-testid=${`diff-${props.clauseId}`}>
          ${active === 'accept'
            ? html`<span class="rl-clause__keep">${props.theirsText}</span
                ><span class="rl-clause__keep-tag">(Accepted as drafted)</span>`
            : active === 'fallback'
              ? html`<del class="rl-clause__del">${props.theirsText}</del
                  ><ins class="rl-clause__ins rl-clause__ins--fallback">${props.fallbackText}</ins>`
              : html`<del class="rl-clause__del">${props.theirsText}</del
                  ><ins class="rl-clause__ins rl-clause__ins--counter">${props.counterText}</ins>`}
        </div>

        ${props.rationale ? html`<div class="rl-clause__why">${props.rationale}</div>` : nothing}
        ${props.evidenceChild && this.isChildResolved(props.evidenceChild)
          ? html`<div class="rl-clause__evidence">${this.renderNode(props.evidenceChild)}</div>`
          : nothing}
      </article>
    `;
  }
}

export const A2uiClauseRedline = {
  ...ClauseRedlineApi,
  tagName: A2uiClauseRedlineElement.tagName,
  element: A2uiClauseRedlineElement,
};
