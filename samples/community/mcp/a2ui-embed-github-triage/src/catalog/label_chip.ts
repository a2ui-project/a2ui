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

/** The `LabelChip` component: a GitHub label with its own colors. */

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {A2uiLitElement, type ComponentApi, DynamicStringSchema, spec} from '@a2ui/web_core/v1_0';

/** Component API of `LabelChip`. */
export const LabelChipApi = {
  name: 'LabelChip',
  schema: spec(
    z
      .object({
        name: DynamicStringSchema.describe('REF:#/$defs/DynamicString|The label name.'),
        color: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional background color as 6 hex digits without #, as GitHub returns it. Defaults to a light gray.',
        ).optional(),
        description: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional label description, shown as a tooltip.',
        ).optional(),
      })
      .describe('A GitHub label chip in the label color, with readable text on top of it.')
      .strict(),
    {mixins: [], required: ['name']},
  ),
} satisfies ComponentApi;

/** Returns `color` as `#rrggbb` when it is 6 hex digits (with or without `#`), else a light gray. */
export function labelBackground(color: unknown): string {
  const hex = typeof color === 'string' ? color.replace(/^#/, '') : '';
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : '#ededed';
}

/** Returns black or white, whichever reads better on `background` (`#rrggbb`), using WCAG relative luminance. */
export function labelForeground(background: string): '#000000' | '#ffffff' {
  const channels = [1, 3, 5].map(index => {
    const value = Number.parseInt(background.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  // Contrast with black is (L + 0.05) / 0.05 and with white 1.05 / (L + 0.05).
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

/** `LabelChip` element. */
export class A2uiLabelChipElement extends A2uiLitElement<typeof LabelChipApi> {
  static readonly tagName = 'a2ui-triage-label-chip';

  static override styles = css`
    :host {
      display: inline-block;
      max-width: 100%;
    }
    span {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 500;
      line-height: 20px;
      /* A mid-gray outline keeps near-black and near-white labels visible on dark and light themes. */
      border: 1px solid rgb(127 127 127 / 0.6);
    }
  `;

  protected override readonly api = LabelChipApi;

  override render() {
    const props = this.controller?.props;
    if (!props || typeof props.name !== 'string' || props.name === '') return nothing;
    const background = labelBackground(props.color);
    const description = typeof props.description === 'string' ? props.description : '';
    return html`<span
      style="background:${background};color:${labelForeground(background)}"
      title=${description || props.name}
      >${props.name}</span
    >`;
  }
}

/** `LabelChip` implementation for the triage catalog. */
export const A2uiLabelChip = {
  ...LabelChipApi,
  tagName: A2uiLabelChipElement.tagName,
  element: A2uiLabelChipElement,
};
