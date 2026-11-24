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

/** Shared light/dark adaptive CSS tokens for the Space & Seating Planner catalog. */

import {css} from 'lit';

export const CANVAS_THEME_VARS = css`
  :host {
    --cs-bg: var(
      --a2ui-color-background,
      var(--color-background-primary, light-dark(#ffffff, #1e1f20))
    );
    --cs-surface: var(
      --a2ui-color-surface,
      var(--color-background-secondary, light-dark(#f7f9fc, #26282b))
    );
    --cs-surface-alt: var(
      --a2ui-color-secondary,
      var(--color-background-tertiary, light-dark(#eef2f7, #323539))
    );
    --cs-text: var(
      --a2ui-color-on-surface,
      var(--color-text-primary, light-dark(#1b1f24, #e6e8eb))
    );
    --cs-muted: var(
      --a2ui-text-caption-color,
      var(--color-text-secondary, light-dark(#5b636e, #9ea6b2))
    );
    --cs-border: var(
      --a2ui-color-border,
      var(--color-border-primary, light-dark(#d8dee6, #3d4248))
    );
    --cs-accent: var(--a2ui-color-primary, var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8)));
    --cs-pass-bg: light-dark(#e6f4ea, #163322);
    --cs-pass-border: light-dark(#81c995, #2f7d4a);
    --cs-pass-fg: light-dark(#137333, #81c995);
    --cs-warn-bg: light-dark(#fef7e0, #392b0f);
    --cs-warn-border: light-dark(#f7cb4d, #8d6b18);
    --cs-warn-fg: light-dark(#a65a00, #fdd663);
    --cs-fail-bg: light-dark(#fce8e6, #3e1716);
    --cs-fail-border: light-dark(#f28b82, #a13c38);
    --cs-fail-fg: light-dark(#c5221f, #f28b82);
    box-sizing: border-box;
    font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
  }
`;

export function childKey(child: unknown): string {
  if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
    const rec = child as Record<string, unknown>;
    return `${String(rec['basePath'] ?? '')}/${String(rec['id'] ?? '')}`;
  }
  return String(child);
}
