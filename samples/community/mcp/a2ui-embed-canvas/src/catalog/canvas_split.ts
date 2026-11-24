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
import {repeat} from 'lit/directives/repeat.js';
import {z} from 'zod';

import {
  A2uiLitElement,
  ChildListSchema,
  type ComponentApi,
  type ResolvedChildList,
  spec,
} from '@a2ui/web_core/v1_0';

import {CANVAS_THEME_VARS, childKey} from './styles.js';

export const CanvasSplitApi = {
  name: 'CanvasSplit',
  schema: spec(
    z
      .object({
        children: ChildListSchema.describe(
          'REF:#/$defs/ChildList|Two-column responsive workspace items (stage on left, inspector or tray on right).',
        ),
        ratio: z.enum(['canvas_wide', 'balanced']).describe('Column proportion preset.').optional(),
      })
      .describe('Responsive two-column split layout pairing the SVG stage with contextual tools.')
      .strict(),
    {mixins: [], required: ['children']},
  ),
} satisfies ComponentApi;

/**
 * Responsive two-column split container for pairing `PlanCanvas` with
 * `SelectionInspector` or `PieceTray`.
 *
 * @cssprop [--a2ui-canvas-split-gap=10px] - Grid gap between split panes.
 */
export class A2uiCanvasSplitElement extends A2uiLitElement<typeof CanvasSplitApi> {
  static readonly tagName = 'a2ui-canvas-split';

  static override styles = [
    CANVAS_THEME_VARS,
    css`
      :host {
        display: block;
      }
      .cs-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.48fr) minmax(215px, 1fr);
        gap: var(--a2ui-canvas-split-gap, 10px);
        align-items: stretch;
      }
      .cs-grid[data-ratio='balanced'] {
        grid-template-columns: minmax(0, 1.2fr) minmax(225px, 1fr);
      }
      @media (max-width: 560px) {
        .cs-grid,
        .cs-grid[data-ratio='balanced'] {
          grid-template-columns: 1fr;
        }
      }
      .cs-cell {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
    `,
  ];

  protected override readonly api = CanvasSplitApi;

  override render() {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    if (!props) return nothing;
    const children: ResolvedChildList = Array.isArray(props['children'])
      ? (props['children'] as ResolvedChildList)
      : [];
    const ratio = typeof props['ratio'] === 'string' ? props['ratio'] : 'canvas_wide';

    return html`
      <div class="cs-grid" data-ratio=${ratio}>
        ${repeat(
          children,
          childKey,
          child => html`<div class="cs-cell">${this.renderNode(child)}</div>`,
        )}
      </div>
    `;
  }
}

export const A2uiCanvasSplit = {
  ...CanvasSplitApi,
  tagName: A2uiCanvasSplitElement.tagName,
  element: A2uiCanvasSplitElement,
};
