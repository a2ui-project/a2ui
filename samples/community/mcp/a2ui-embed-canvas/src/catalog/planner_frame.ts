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
  ChildSchema,
  type ComponentApi,
  DynamicStringSchema,
  DynamicValueSchema,
  type ResolvedChildList,
  spec,
} from '@a2ui/web_core/v1_0';

import type {PlanEvaluation} from '../domain/types.js';
import {CANVAS_THEME_VARS, childKey} from './styles.js';

export const PlannerFrameApi = {
  name: 'PlannerFrame',
  schema: spec(
    z
      .object({
        title: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Primary title of the spatial or seating workspace.',
        ),
        subtitle: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Compact subtitle or architectural scale caption.',
        ).optional(),
        evaluation: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Live plan evaluation object from evaluatePlan.',
        ).optional(),
        children: ChildListSchema.describe(
          'REF:#/$defs/ChildList|Ordered body components inside the planner card.',
        ),
        footer: ChildSchema.describe(
          'REF:#/$defs/Child|Optional footer action bar component.',
        ).optional(),
      })
      .describe(
        'Outer card frame for Space & Seating Planner with live score header and footer slot.',
      )
      .strict(),
    {mixins: [], required: ['title', 'children']},
  ),
} satisfies ComponentApi;

/**
 * Outer card frame for Space & Seating Planner.
 *
 * @cssprop [--a2ui-planner-frame-padding=12px 14px] - Outer card padding.
 * @cssprop [--a2ui-planner-frame-radius=12px] - Outer card border radius.
 */
export class A2uiPlannerFrameElement extends A2uiLitElement<typeof PlannerFrameApi> {
  static readonly tagName = 'a2ui-canvas-planner-frame';

  static override styles = [
    CANVAS_THEME_VARS,
    css`
      :host {
        display: block;
      }
      .pf-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: var(--a2ui-planner-frame-padding, 12px 14px);
        border-radius: var(--a2ui-planner-frame-radius, var(--a2ui-border-radius, 12px));
        border: 1px solid var(--cs-border);
        background: var(--cs-bg);
        color: var(--cs-text);
      }
      .pf-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .pf-titles {
        min-width: 0;
        flex: 1;
      }
      .pf-title {
        margin: 0;
        font-size: 15px;
        font-weight: 650;
        line-height: 1.25;
        letter-spacing: -0.01em;
        color: var(--cs-text);
      }
      .pf-subtitle {
        margin: 2px 0 0;
        font-size: 12px;
        line-height: 1.35;
        color: var(--cs-muted);
      }
      .pf-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
        padding: 3px 9px;
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 600;
        line-height: 1.3;
        border: 1px solid var(--cs-border);
        background: var(--cs-surface);
        color: var(--cs-text);
      }
      .pf-badge[data-status='pass'] {
        background: var(--cs-pass-bg);
        border-color: var(--cs-pass-border);
        color: var(--cs-pass-fg);
      }
      .pf-badge[data-status='warn'] {
        background: var(--cs-warn-bg);
        border-color: var(--cs-warn-border);
        color: var(--cs-warn-fg);
      }
      .pf-badge[data-status='fail'] {
        background: var(--cs-fail-bg);
        border-color: var(--cs-fail-border);
        color: var(--cs-fail-fg);
      }
      .pf-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
      }
      .pf-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .pf-footer {
        padding-top: 6px;
        border-top: 1px solid var(--cs-border);
      }
    `,
  ];

  protected override readonly api = PlannerFrameApi;

  override render() {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    if (!props) return nothing;

    const title = typeof props['title'] === 'string' ? props['title'] : '';
    const subtitle = typeof props['subtitle'] === 'string' ? props['subtitle'] : '';
    const evaluation =
      typeof props['evaluation'] === 'object' &&
      props['evaluation'] !== null &&
      !Array.isArray(props['evaluation'])
        ? (props['evaluation'] as unknown as PlanEvaluation)
        : undefined;
    const children: ResolvedChildList = Array.isArray(props['children'])
      ? (props['children'] as ResolvedChildList)
      : [];
    const footer = props['footer'] as Parameters<typeof this.renderNode>[0];

    return html`
      <section class="pf-card" aria-label=${title || 'Space & Seating Planner'}>
        <header class="pf-header">
          <div class="pf-titles">
            <h1 class="pf-title">${title}</h1>
            ${subtitle ? html`<p class="pf-subtitle">${subtitle}</p>` : nothing}
          </div>
          ${evaluation
            ? html`
                <div
                  class="pf-badge"
                  data-status=${evaluation.status}
                  role="status"
                  aria-label="Plan score ${evaluation.summary}"
                >
                  <span class="pf-dot" aria-hidden="true"></span>
                  <span>${evaluation.summary}</span>
                </div>
              `
            : nothing}
        </header>
        <div class="pf-body">
          ${repeat(children, childKey, child => html`${this.renderNode(child)}`)}
        </div>
        ${footer ? html`<footer class="pf-footer">${this.renderNode(footer)}</footer>` : nothing}
      </section>
    `;
  }
}

export const A2uiPlannerFrame = {
  ...PlannerFrameApi,
  tagName: A2uiPlannerFrameElement.tagName,
  element: A2uiPlannerFrameElement,
};
