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
 * The `Avatar` component: a sender's initials on a color derived from their
 * name. It draws no image, so it needs nothing from the network.
 */

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {A2uiLitElement, type ComponentApi, DynamicStringSchema, spec} from '@a2ui/web_core/v1_0';

/** Component API of `Avatar`. */
export const AvatarApi = {
  name: 'Avatar',
  schema: spec(
    z
      .object({
        name: DynamicStringSchema.describe(
          "REF:#/$defs/DynamicString|The person's or sender's name.",
        ),
        size: z
          .number()
          .int()
          .min(16)
          .max(64)
          .describe('Optional diameter in pixels. Defaults to 28.')
          .optional(),
      })
      .describe('A round avatar with the initials of a name.')
      .strict(),
    {mixins: [], required: ['name']},
  ),
} satisfies ComponentApi;

/** Up to two initials of a name, such as `MC` for `Maya Chen` or `NP` for `Northwest Power & Light`. */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const letters =
    words.length > 1 ? words[0]!.charAt(0) + words[1]!.charAt(0) : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** Hue of the background, stable per name. */
export function hue(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/** `Avatar` element. */
export class A2uiAvatarElement extends A2uiLitElement<typeof AvatarApi> {
  static readonly tagName = 'a2ui-inbox-avatar';

  static override styles = css`
    :host {
      display: inline-flex;
      flex: none;
      vertical-align: middle;
    }
    span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-weight: 600;
      color: #fff;
      letter-spacing: 0.02em;
      user-select: none;
    }
  `;

  protected override readonly api = AvatarApi;

  override render() {
    const props = this.controller?.props;
    if (!props || typeof props.name !== 'string') return nothing;
    const size = props.size ?? 28;
    const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:hsl(${hue(props.name)} 42% 46%)`;
    return html`<span style=${style} title=${props.name} aria-hidden="true"
      >${initials(props.name)}</span
    >`;
  }
}

/** `Avatar` implementation for the inbox catalog. */
export const A2uiAvatar = {
  ...AvatarApi,
  tagName: A2uiAvatarElement.tagName,
  element: A2uiAvatarElement,
};
