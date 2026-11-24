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
  type ComponentApi,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import type {PlacementItem, PlanPreset} from '../domain/types.js';
import {CANVAS_THEME_VARS} from './styles.js';

export const PresetStripApi = {
  name: 'PresetStrip',
  schema: spec(
    z
      .object({
        presets: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Agent-recommended layout presets.',
        ),
        placements: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Two-way bound placements array updated on preset click.',
        ),
        activePresetId: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional two-way bound active preset ID.',
        ).optional(),
      })
      .describe('One-click layout preset strip updating placements client-side.')
      .strict(),
    {mixins: [], required: ['presets', 'placements']},
  ),
} satisfies ComponentApi;

/**
 * One-click preset strip updating `/placements` client-side with zero round-trips.
 *
 * @cssprop [--a2ui-preset-strip-gap=6px] - Gap between preset buttons.
 */
export class A2uiPresetStripElement extends A2uiLitElement<typeof PresetStripApi> {
  static readonly tagName = 'a2ui-canvas-preset-strip';

  static override styles = [
    CANVAS_THEME_VARS,
    css`
      :host {
        display: block;
      }
      .ps-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--a2ui-preset-strip-gap, 6px);
      }
      .ps-lead {
        font-size: 11.5px;
        font-weight: 600;
        color: var(--cs-muted);
        margin-right: 2px;
      }
      .ps-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 9px;
        border-radius: 999px;
        border: 1px solid var(--cs-border);
        background: var(--cs-surface);
        color: var(--cs-text);
        font: inherit;
        font-size: 11.5px;
        line-height: 1.25;
        cursor: pointer;
      }
      .ps-btn:hover {
        border-color: var(--cs-accent);
      }
      .ps-btn[aria-pressed='true'] {
        background: color-mix(in srgb, var(--cs-accent) 14%, var(--cs-bg));
        border-color: var(--cs-accent);
        font-weight: 600;
      }
      .ps-star {
        color: var(--cs-accent);
        font-weight: 700;
      }
      .ps-tag {
        color: var(--cs-muted);
        font-size: 11px;
      }
    `,
  ];

  protected override readonly api = PresetStripApi;

  override render() {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    if (!props) return nothing;
    const presets = Array.isArray(props['presets']) ? (props['presets'] as PlanPreset[]) : [];
    if (presets.length === 0) return nothing;

    const activePresetId =
      typeof props['activePresetId'] === 'string' ? props['activePresetId'] : '';
    const setPlacements = props['setPlacements'] as ((val: PlacementItem[]) => void) | undefined;
    const setActivePresetId = props['setActivePresetId'] as ((val: string) => void) | undefined;

    return html`
      <div class="ps-bar" role="group" aria-label="Recommended layout presets">
        <span class="ps-lead">Presets:</span>
        ${presets.map(preset => {
          const active = activePresetId === preset.id;
          return html`
            <button
              type="button"
              class="ps-btn"
              aria-pressed=${active ? 'true' : 'false'}
              @click=${() => {
                if (setPlacements) {
                  setPlacements(preset.placements.map(item => ({...item})));
                }
                setActivePresetId?.(preset.id);
              }}
            >
              ${preset.recommended
                ? html`<span class="ps-star" aria-hidden="true">★</span>`
                : nothing}
              <span>${preset.label}</span>
              <span class="ps-tag">· ${preset.tagline}</span>
            </button>
          `;
        })}
      </div>
    `;
  }
}

export const A2uiPresetStrip = {
  ...PresetStripApi,
  tagName: A2uiPresetStripElement.tagName,
  element: A2uiPresetStripElement,
};
