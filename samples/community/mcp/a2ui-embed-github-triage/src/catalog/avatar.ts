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
 * The `Avatar` component: a GitHub avatar that falls back to initials when
 * the image is missing, not from GitHub's avatar host, or blocked (for
 * example by a host CSP that ignores the app's `resourceDomains`).
 */

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {A2uiLitElement, type ComponentApi, DynamicStringSchema, spec} from '@a2ui/web_core/v1_0';

/** The only origin avatars load from; the server declares it in the app resource CSP. */
export const AVATAR_ORIGIN = 'https://avatars.githubusercontent.com';

/** Component API of `Avatar`. */
export const AvatarApi = {
  name: 'Avatar',
  schema: spec(
    z
      .object({
        login: DynamicStringSchema.describe('REF:#/$defs/DynamicString|The GitHub login.'),
        url: DynamicStringSchema.describe(
          `REF:#/$defs/DynamicString|Optional avatar image URL on ${AVATAR_ORIGIN}. Other URLs show initials.`,
        ).optional(),
        size: z
          .number()
          .int()
          .min(12)
          .max(96)
          .describe('Optional diameter in pixels. Defaults to 24.')
          .optional(),
        showLogin: z
          .boolean()
          .describe('Optional. Shows the login next to the avatar. Defaults to false.')
          .optional(),
      })
      .describe('A round GitHub avatar with initials as the fallback.')
      .strict(),
    {mixins: [], required: ['login']},
  ),
} satisfies ComponentApi;

/** Returns `url` with a size parameter when it is an avatar URL on {@link AVATAR_ORIGIN}, else `undefined`. */
export function avatarSource(url: unknown, size: number): string | undefined {
  if (typeof url !== 'string') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.origin !== AVATAR_ORIGIN) return undefined;
  parsed.searchParams.set('s', String(size * 2));
  return parsed.toString();
}

/** Up to two initials of a login, such as `GH` for `ghost-hunter`. */
export function initials(login: string): string {
  const parts = login.split(/[-_.\s]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]!.charAt(0) + parts[1]!.charAt(0) : login.slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** Hue for the initials background, stable per login. */
function hue(login: string): number {
  let hash = 0;
  for (const char of login) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/** `Avatar` element. */
export class A2uiAvatarElement extends A2uiLitElement<typeof AvatarApi> {
  static readonly tagName = 'a2ui-triage-avatar';

  static override properties = {failed: {state: true}};

  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      vertical-align: middle;
    }
    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      border-radius: 50%;
      overflow: hidden;
      font-size: 10px;
      font-weight: 600;
      color: #fff;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .login {
      font-size: 13px;
    }
  `;

  protected override readonly api = AvatarApi;

  /** Whether the image failed to load. */
  declare failed: boolean;
  private failedSource: string | undefined;

  constructor() {
    super();
    this.failed = false;
  }

  override render() {
    const props = this.controller?.props;
    if (!props || typeof props.login !== 'string') return nothing;
    const size = props.size ?? 24;
    const source = avatarSource(props.url, size);
    const showImage = source !== undefined && !(this.failed && this.failedSource === source);
    const box = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:${
      showImage ? 'transparent' : `hsl(${hue(props.login)} 45% 45%)`
    }`;
    return html`<span class="avatar" style=${box} title=${props.login}
        >${showImage
          ? html`<img
              src=${source}
              alt=""
              referrerpolicy="no-referrer"
              @error=${() => {
                this.failedSource = source;
                this.failed = true;
              }}
            />`
          : initials(props.login)}</span
      >${props.showLogin ? html`<span class="login">${props.login}</span>` : nothing}`;
  }
}

/** `Avatar` implementation for the triage catalog. */
export const A2uiAvatar = {
  ...AvatarApi,
  tagName: A2uiAvatarElement.tagName,
  element: A2uiAvatarElement,
};
