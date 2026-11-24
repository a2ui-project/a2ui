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
  ChildSchema,
  type ComponentApi,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import type {InspectedItem} from '../domain/types.js';
import {CANVAS_THEME_VARS} from './styles.js';

export const SelectionInspectorApi = {
  name: 'SelectionInspector',
  schema: spec(
    z
      .object({
        inspection: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Contextual item or guest inspection object from inspectItem.',
        ),
        extraChild: ChildSchema.describe(
          'REF:#/$defs/Child|Optional slotted child component (such as PieceTray) rendered inside the inspector.',
        ).optional(),
      })
      .describe(
        'Contextual inspector displaying dimensions, coordinates, or seat pairings for the selected item.',
      )
      .strict(),
    {mixins: [], required: ['inspection']},
  ),
} satisfies ComponentApi;

/**
 * Contextual inspector bound to `@call: inspectItem(/scene, /placements, /selectedId)`
 * with an optional `extraChild` slot.
 *
 * @cssprop [--a2ui-selection-inspector-padding=10px] - Inspector card padding.
 */
export class A2uiSelectionInspectorElement extends A2uiLitElement<typeof SelectionInspectorApi> {
  static readonly tagName = 'a2ui-canvas-selection-inspector';

  static override styles = [
    CANVAS_THEME_VARS,
    css`
      :host {
        display: block;
        height: 100%;
      }
      .si-card {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 8px;
        height: 100%;
        padding: var(--a2ui-selection-inspector-padding, 10px);
        border-radius: 10px;
        border: 1px solid var(--cs-border);
        background: var(--cs-surface);
        color: var(--cs-text);
      }
      .si-top {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .si-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 6px;
      }
      .si-title {
        font-size: 13px;
        font-weight: 650;
        line-height: 1.25;
      }
      .si-sub {
        font-size: 11.5px;
        color: var(--cs-muted);
        margin-top: 1px;
      }
      .si-badge {
        font-size: 10.5px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid var(--cs-border);
        background: var(--cs-bg);
        color: var(--cs-muted);
        white-space: nowrap;
      }
      .si-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .si-chip {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        padding: 2px 7px;
        border-radius: 6px;
        background: var(--cs-bg);
        border: 1px solid var(--cs-border);
        font-size: 11px;
      }
      .si-chip-k {
        color: var(--cs-muted);
        font-weight: 500;
      }
      .si-chip-v {
        font-weight: 650;
      }
      .si-note {
        margin: 0;
        font-size: 11.5px;
        line-height: 1.35;
        color: var(--cs-muted);
      }
      .si-slot {
        padding-top: 7px;
        border-top: 1px solid var(--cs-border);
      }
    `,
  ];

  protected override readonly api = SelectionInspectorApi;

  override render() {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    if (!props) return nothing;
    const raw = props['inspection'];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return nothing;
    const info = raw as unknown as InspectedItem;
    const extraChild = props['extraChild'] as Parameters<typeof this.renderNode>[0];
    const metrics = Array.isArray(info.metrics) ? info.metrics : [];

    return html`
      <aside class="si-card" aria-label="Selected item inspector">
        <div class="si-top">
          <div class="si-head">
            <div>
              <div class="si-title">${info.title}</div>
              <div class="si-sub">${info.subtitle}</div>
            </div>
            ${info.badge ? html`<span class="si-badge">${info.badge}</span>` : nothing}
          </div>
          ${metrics.length > 0
            ? html`
                <div class="si-metrics">
                  ${metrics.map(
                    m => html`
                      <span class="si-chip">
                        <span class="si-chip-k">${m.label}</span>
                        <span class="si-chip-v">${m.value}</span>
                      </span>
                    `,
                  )}
                </div>
              `
            : nothing}
          ${info.note ? html`<p class="si-note">${info.note}</p>` : nothing}
        </div>
        ${extraChild ? html`<div class="si-slot">${this.renderNode(extraChild)}</div>` : nothing}
      </aside>
    `;
  }
}

export const A2uiSelectionInspector = {
  ...SelectionInspectorApi,
  tagName: A2uiSelectionInspectorElement.tagName,
  element: A2uiSelectionInspectorElement,
};
