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
 * Top-level `NegotiationBoard` shell and responsive `TwoUpRow` container for
 * the Redline Negotiator custom catalog.
 */

import {css, html, nothing} from 'lit';
import {repeat} from 'lit/directives/repeat.js';
import {svg} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  ChildListSchema,
  ChildSchema,
  DynamicStringSchema,
  spec,
  type A2uiChildRef,
  type ComponentApi,
  type ResolvedChildList,
} from '@a2ui/web_core/v1_0';

import {REDLINE_TOKENS} from './theme_tokens.js';

function childKey(child: A2uiChildRef): string {
  return typeof child === 'object' && child !== null
    ? `${child.basePath ?? ''}/${child.id}`
    : String(child);
}

export const NegotiationBoardApi = {
  name: 'NegotiationBoard',
  schema: spec(
    z
      .object({
        title: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Agreement or quote title shown in the board header.',
        ),
        subtitle: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional counterparty and headline terms line.',
        ).optional(),
        summaryBadge: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional right-aligned deal category or summary badge.',
        ).optional(),
        statusBanner: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional status banner updated by server actions.',
        ).optional(),
        children: ChildListSchema.describe(
          'REF:#/$defs/ChildList|Ordered main body components inside the negotiation board.',
        ),
        footer: ChildSchema.describe(
          'REF:#/$defs/Child|Optional footer component ID, typically CounterLetterPreview.',
        ).optional(),
      })
      .describe('Primary negotiation studio shell with header badge, body stack, and footer slot.')
      .strict(),
    {mixins: [], required: ['title', 'children']},
  ),
} satisfies ComponentApi;

export class A2uiNegotiationBoardElement extends A2uiLitElement<typeof NegotiationBoardApi> {
  static readonly tagName = 'a2ui-redline-board';

  static override styles = [
    REDLINE_TOKENS,
    css`
      :host {
        display: block;
      }
      .rl-board {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 8px 10px;
        border: 1px solid var(--rl-border);
        border-radius: var(--rl-radius);
        background: var(--rl-bg);
      }
      .rl-board__hdr {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 5px;
        border-bottom: 1px solid var(--rl-border);
      }
      .rl-board__title-wrap {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
      }
      .rl-board__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: var(--rl-primary-soft);
        color: var(--rl-primary);
        flex: none;
      }
      .rl-board__titles {
        min-width: 0;
      }
      .rl-board__title {
        margin: 0;
        font-size: 13.5px;
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: -0.01em;
        color: var(--rl-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rl-board__sub {
        margin: 1px 0 0;
        font-size: 11px;
        line-height: 1.2;
        color: var(--rl-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rl-board__badge {
        flex: none;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 600;
        background: var(--rl-surface-raised);
        color: var(--rl-text);
        border: 1px solid var(--rl-border);
      }
      .rl-board__banner {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        background: var(--rl-good-soft);
        color: var(--rl-good);
        border: 1px solid var(--rl-good);
      }
      .rl-board__body {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .rl-board__footer {
        margin-top: 1px;
      }
    `,
  ];

  protected override readonly api = NegotiationBoardApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const children: ResolvedChildList = Array.isArray(props.children) ? props.children : [];
    const resolvedChildren = children.filter(child => this.isChildResolved(child));
    const banner = typeof props.statusBanner === 'string' ? props.statusBanner.trim() : '';

    return html`
      <section class="rl-board" aria-label=${String(props.title || 'Negotiation board')}>
        <header class="rl-board__hdr">
          <div class="rl-board__title-wrap">
            <span class="rl-board__icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 2.5h6.5L13 6v7.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"
                  stroke="currentColor"
                  stroke-width="1.4"
                />
                <path
                  d="M5 8.5h6M5 11h4M9 2.5V6h3.5"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linecap="round"
                />
              </svg>
            </span>
            <div class="rl-board__titles">
              <h1 class="rl-board__title">${props.title}</h1>
              ${props.subtitle ? html`<p class="rl-board__sub">${props.subtitle}</p>` : nothing}
            </div>
          </div>
          ${props.summaryBadge
            ? html`<span class="rl-board__badge">${props.summaryBadge}</span>`
            : nothing}
        </header>
        ${banner
          ? html`<div class="rl-board__banner" role="status" data-testid="status-banner">
              ${svg`<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`}
              <span>${banner}</span>
            </div>`
          : nothing}
        <div class="rl-board__body">
          ${repeat(resolvedChildren, childKey, child => html`${this.renderNode(child)}`)}
        </div>
        ${props.footer && this.isChildResolved(props.footer)
          ? html`<div class="rl-board__footer">${this.renderNode(props.footer)}</div>`
          : nothing}
      </section>
    `;
  }
}

export const A2uiNegotiationBoard = {
  ...NegotiationBoardApi,
  tagName: A2uiNegotiationBoardElement.tagName,
  element: A2uiNegotiationBoardElement,
};

export const TwoUpRowApi = {
  name: 'TwoUpRow',
  schema: spec(
    z
      .object({
        children: ChildListSchema.describe(
          'REF:#/$defs/ChildList|Side-by-side components arranged in a responsive two-column grid.',
        ),
      })
      .describe('Two-column side-by-side layout row for pairing gauges or line-item benchmarks.')
      .strict(),
    {mixins: [], required: ['children']},
  ),
} satisfies ComponentApi;

export class A2uiTwoUpRowElement extends A2uiLitElement<typeof TwoUpRowApi> {
  static readonly tagName = 'a2ui-redline-two-up';

  static override styles = [
    REDLINE_TOKENS,
    css`
      :host {
        display: block;
      }
      .rl-twoup {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 6px;
        align-items: stretch;
      }
    `,
  ];

  protected override readonly api = TwoUpRowApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const children: ResolvedChildList = Array.isArray(props.children) ? props.children : [];
    const resolved = children.filter(child => this.isChildResolved(child));
    return html`<div class="rl-twoup">
      ${repeat(resolved, childKey, child => html`${this.renderNode(child)}`)}
    </div>`;
  }
}

export const A2uiTwoUpRow = {
  ...TwoUpRowApi,
  tagName: A2uiTwoUpRowElement.tagName,
  element: A2uiTwoUpRowElement,
};
