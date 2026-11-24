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
 * Structural custom catalog components:
 * - `MixerDeck`: Outer card shell with title, recommendation summary, live convergence badge,
 *   `children: ChildListSchema`, and `footer?: ChildSchema`.
 * - `MixerGrid`: Multi-column responsive grid container (`children: ChildListSchema`).
 * - `MixMicroNote`: Compact inline callout leaf for `PortionScrubTile` `detailChild` slots.
 */

import {css, html, nothing} from 'lit';
import {repeat} from 'lit/directives/repeat.js';
import {z} from 'zod';

import {
  A2uiLitElement,
  ChildListSchema,
  ChildSchema,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
  type A2uiChildRef,
  type ComponentApi,
  type ResolvedChildList,
} from '@a2ui/web_core/v1_0';

function getChildKey(child: A2uiChildRef): string {
  return typeof child === 'object' && child !== null
    ? `${child.basePath ?? ''}/${child.id}`
    : String(child);
}

export const MixerDeckApi = {
  name: 'MixerDeck',
  schema: spec(
    z
      .object({
        title: DynamicStringSchema.describe('REF:#/$defs/DynamicString|Primary studio title.'),
        subtitle: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Concise recommendation summary.',
        ).optional(),
        scenarioBadge: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Domain badge label.',
        ).optional(),
        totals: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Live result of computeMixTotals(/items, /targets) for the convergence badge.',
        ).optional(),
        children: ChildListSchema.describe(
          'REF:#/$defs/ChildList|Ordered main stage sections composed for this scenario.',
        ),
        footer: ChildSchema.describe(
          'REF:#/$defs/Child|Optional footer component such as CommitBar.',
        ).optional(),
      })
      .describe(
        'Top-level trade-off mixer deck with live target convergence header and footer slot.',
      )
      .strict(),
    {mixins: [], required: ['title', 'children']},
  ),
} satisfies ComponentApi;

/**
 * @cssprop [--a2ui-mixer-deck-bg=var(--color-background-primary)] - Deck surface background.
 * @cssprop [--a2ui-mixer-deck-border=var(--color-border-primary)] - Outer deck border color.
 * @cssprop [--a2ui-mixer-deck-padding=10px 12px] - Internal deck padding.
 */
export class A2uiMixerDeckElement extends A2uiLitElement<typeof MixerDeckApi> {
  static readonly tagName = 'a2ui-mixer-deck';

  static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
    }
    .mixer-deck {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: var(--a2ui-mixer-deck-padding, 10px 12px);
      border-radius: var(--border-radius-md, 12px);
      background: var(
        --a2ui-mixer-deck-bg,
        var(--color-background-primary, light-dark(#ffffff, #1e1f20))
      );
      border: 1px solid
        var(--a2ui-mixer-deck-border, var(--color-border-primary, light-dark(#dadce0, #444746)));
      color: var(--color-text-primary, light-dark(#1f1f1f, #e3e3e3));
    }
    .mixer-deck__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--color-border-primary, light-dark(#eceff1, #343638));
    }
    .mixer-deck__titles {
      min-width: 0;
      flex: 1;
    }
    .mixer-deck__eyebrow-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .mixer-deck__domain-pill {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--color-background-secondary, light-dark(#eef3fc, #2a303c));
      color: var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8));
    }
    .mixer-deck__title {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.25;
      color: var(--color-text-primary, light-dark(#1f1f1f, #e3e3e3));
    }
    .mixer-deck__subtitle {
      margin: 2px 0 0;
      font-size: 11.5px;
      line-height: 1.3;
      color: var(--color-text-secondary, light-dark(#5f6368, #a8abb0));
    }
    .mixer-deck__badge {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.2;
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .mixer-deck__badge[data-converged='true'] {
      background: light-dark(#e6f4ea, #173322);
      color: light-dark(#137333, #81c995);
      border-color: light-dark(#ceead6, #275838);
    }
    .mixer-deck__badge[data-converged='false'] {
      background: light-dark(#fef7e0, #382c11);
      color: light-dark(#b06000, #fdd663);
      border-color: light-dark(#feefc3, #5c4617);
    }
    .mixer-deck__body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .mixer-deck__footer {
      padding-top: 2px;
    }
  `;

  protected override readonly api = MixerDeckApi;

  private renderSection(child: A2uiChildRef) {
    return html`${this.renderNode(child)}`;
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const title = typeof props['title'] === 'string' ? props['title'] : '';
    const subtitle = typeof props['subtitle'] === 'string' ? props['subtitle'] : '';
    const scenarioBadge = typeof props['scenarioBadge'] === 'string' ? props['scenarioBadge'] : '';
    const totals =
      props['totals'] && typeof props['totals'] === 'object' && !Array.isArray(props['totals'])
        ? (props['totals'] as Record<string, unknown>)
        : undefined;
    const hits = typeof totals?.['hits'] === 'number' ? totals['hits'] : 0;
    const total = typeof totals?.['total'] === 'number' ? totals['total'] : 0;
    const converged = Boolean(totals?.['converged']);
    const children: ResolvedChildList = Array.isArray(props['children']) ? props['children'] : [];
    const footer = props['footer'];

    return html`
      <section class="mixer-deck" role="region" aria-label=${title || 'Goal Mixer'}>
        <header class="mixer-deck__header">
          <div class="mixer-deck__titles">
            <div class="mixer-deck__eyebrow-row">
              ${scenarioBadge
                ? html`<span class="mixer-deck__domain-pill">${scenarioBadge}</span>`
                : nothing}
              <h1 class="mixer-deck__title">${title}</h1>
            </div>
            ${subtitle ? html`<p class="mixer-deck__subtitle">${subtitle}</p>` : nothing}
          </div>
          ${total > 0
            ? html`
                <div
                  class="mixer-deck__badge"
                  data-converged=${converged ? 'true' : 'false'}
                  role="status"
                >
                  <span>${converged ? '✓' : '△'}</span>
                  <span>${hits}/${total} targets ${converged ? 'converged' : 'in band'}</span>
                </div>
              `
            : nothing}
        </header>
        <div class="mixer-deck__body">
          ${repeat(children, getChildKey, child => this.renderSection(child))}
        </div>
        ${footer
          ? html`<footer class="mixer-deck__footer">${this.renderNode(footer)}</footer>`
          : nothing}
      </section>
    `;
  }
}

export const A2uiMixerDeck = {
  ...MixerDeckApi,
  tagName: A2uiMixerDeckElement.tagName,
  element: A2uiMixerDeckElement,
};

export const MixerGridApi = {
  name: 'MixerGrid',
  schema: spec(
    z
      .object({
        columns: z
          .number()
          .int()
          .min(1)
          .max(4)
          .describe('Number of grid columns on desktop widths. Defaults to 2.')
          .optional(),
        children: ChildListSchema.describe('REF:#/$defs/ChildList|Grid child component IDs.'),
      })
      .describe('Responsive multi-column grid layout for mixer visuals and scrub tiles.')
      .strict(),
    {mixins: [], required: ['children']},
  ),
} satisfies ComponentApi;

/**
 * @cssprop [--a2ui-mixer-grid-gap=8px] - Grid gap between children.
 */
export class A2uiMixerGridElement extends A2uiLitElement<typeof MixerGridApi> {
  static readonly tagName = 'a2ui-mixer-grid';

  static override styles = css`
    :host {
      display: block;
    }
    .mixer-grid {
      display: grid;
      gap: var(--a2ui-mixer-grid-gap, 8px);
      align-items: stretch;
    }
    .mixer-grid[data-cols='1'] {
      grid-template-columns: minmax(0, 1fr);
    }
    .mixer-grid[data-cols='2'] {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .mixer-grid[data-cols='3'] {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .mixer-grid[data-cols='4'] {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    @media (max-width: 520px) {
      .mixer-grid[data-cols='2'],
      .mixer-grid[data-cols='3'],
      .mixer-grid[data-cols='4'] {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;

  protected override readonly api = MixerGridApi;

  private renderGridItem(child: A2uiChildRef) {
    return html`${this.renderNode(child)}`;
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const cols = typeof props['columns'] === 'number' ? props['columns'] : 2;
    const children: ResolvedChildList = Array.isArray(props['children']) ? props['children'] : [];
    return html`
      <div class="mixer-grid" data-cols=${String(cols)}>
        ${repeat(children, getChildKey, child => this.renderGridItem(child))}
      </div>
    `;
  }
}

export const A2uiMixerGrid = {
  ...MixerGridApi,
  tagName: A2uiMixerGridElement.tagName,
  element: A2uiMixerGridElement,
};

export const MixMicroNoteApi = {
  name: 'MixMicroNote',
  schema: spec(
    z
      .object({
        text: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Short contextual tip or constraint note.',
        ),
        tone: z
          .enum(['tip', 'constraint', 'accent'])
          .describe('Visual tone for the micro note.')
          .optional(),
      })
      .describe('Compact inline callout rendered inside PortionScrubTile detailChild slots.')
      .strict(),
    {mixins: [], required: ['text']},
  ),
} satisfies ComponentApi;

/**
 * @cssprop [--a2ui-mix-micro-note-color=var(--color-text-secondary)] - Micro note text color.
 */
export class A2uiMixMicroNoteElement extends A2uiLitElement<typeof MixMicroNoteApi> {
  static readonly tagName = 'a2ui-mix-micro-note';

  static override styles = css`
    :host {
      display: block;
    }
    .mix-micro-note {
      font-size: 10.5px;
      line-height: 1.25;
      padding: 3px 6px;
      border-radius: 5px;
      background: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      border: 1px dashed var(--color-border-primary, light-dark(#d2d6dc, #444746));
      color: var(
        --a2ui-mix-micro-note-color,
        var(--color-text-secondary, light-dark(#5f6368, #a8abb0))
      );
    }
    .mix-micro-note[data-tone='constraint'] {
      border-style: solid;
      border-color: light-dark(#f6aea9, #6b2b27);
      color: light-dark(#a50e0e, #f28b82);
    }
  `;

  protected override readonly api = MixMicroNoteApi;

  override render() {
    const props = this.controller?.props;
    if (!props || typeof props['text'] !== 'string') return nothing;
    const tone = typeof props['tone'] === 'string' ? props['tone'] : 'tip';
    return html`<div class="mix-micro-note" data-tone=${tone}>${props['text']}</div>`;
  }
}

export const A2uiMixMicroNote = {
  ...MixMicroNoteApi,
  tagName: A2uiMixMicroNoteElement.tagName,
  element: A2uiMixMicroNoteElement,
};
