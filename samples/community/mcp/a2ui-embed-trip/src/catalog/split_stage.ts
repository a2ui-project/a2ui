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

/** `SplitStage`: responsive two-column stage pairing timeline, map, or swap views. */

import {css, html, nothing} from 'lit';
import {repeat} from 'lit/directives/repeat.js';
import {z} from 'zod';

import {
  A2uiLitElement,
  type A2uiChildRef,
  ChildListSchema,
  type ComponentApi,
  type ResolvedChildList,
  spec,
} from '@a2ui/web_core/v1_0';

function childKey(child: A2uiChildRef): string {
  return typeof child === 'object' && child !== null
    ? `${child.basePath}/${child.id}`
    : String(child);
}

export const SplitStageApi = {
  name: 'SplitStage',
  schema: spec(
    z
      .object({
        ratio: z
          .enum(['balanced', 'wideLeft', 'wideRight'])
          .describe('Column proportion preset for the two-column layout.')
          .optional(),
        children: ChildListSchema.describe(
          'REF:#/$defs/ChildList|Stage panels rendered side by side.',
        ),
      })
      .describe('Two-column responsive stage layout for pairing timeline and map panels.')
      .strict(),
    {mixins: [], required: ['children']},
  ),
} satisfies ComponentApi;

/**
 * @cssprop [--a2ui-splitstage-gap=10px] - Grid gap between stage panels.
 */
export class A2uiSplitStageElement extends A2uiLitElement<typeof SplitStageApi> {
  static readonly tagName = 'a2ui-trip-split-stage';

  static override styles = css`
    :host {
      display: block;
    }
    .ts-stage {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--a2ui-splitstage-gap, 10px);
      align-items: start;
    }
    .ts-stage--wideLeft {
      grid-template-columns: minmax(0, 1.32fr) minmax(220px, 0.9fr);
    }
    .ts-stage--wideRight {
      grid-template-columns: minmax(220px, 0.9fr) minmax(0, 1.32fr);
    }
    .ts-stage__slot {
      min-width: 0;
    }
    @media (max-width: 540px) {
      .ts-stage,
      .ts-stage--wideLeft,
      .ts-stage--wideRight {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;

  protected override readonly api = SplitStageApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const ratio = props['ratio'] ?? 'balanced';
    const rawChildren = props['children'];
    const children: ResolvedChildList = Array.isArray(rawChildren)
      ? rawChildren.filter(child => this.isChildResolved(child))
      : [];

    return html`
      <div class="ts-stage ts-stage--${ratio}">
        ${repeat(
          children,
          childKey,
          child => html`<div class="ts-stage__slot">${this.renderNode(child)}</div>`,
        )}
      </div>
    `;
  }
}

export const A2uiSplitStage = {
  ...SplitStageApi,
  tagName: A2uiSplitStageElement.tagName,
  element: A2uiSplitStageElement,
};
