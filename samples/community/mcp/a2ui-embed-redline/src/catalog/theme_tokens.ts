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

/** Shared light/dark adaptive CSS custom property tokens for Redline Negotiator components. */

import {css} from 'lit';

export const REDLINE_TOKENS = css`
  :host {
    --rl-bg: var(
      --a2ui-color-background,
      var(--color-background-primary, light-dark(#ffffff, #1a1c1e))
    );
    --rl-surface: var(
      --a2ui-color-surface,
      var(--color-background-secondary, light-dark(#f7f8fb, #232629))
    );
    --rl-surface-raised: var(--color-background-tertiary, light-dark(#eef1f6, #2d3136));
    --rl-text: var(
      --a2ui-color-on-surface,
      var(--color-text-primary, light-dark(#181c20, #e6e8ec))
    );
    --rl-muted: var(
      --a2ui-text-caption-color,
      var(--color-text-secondary, light-dark(#56606b, #9da5b0))
    );
    --rl-border: var(
      --a2ui-color-border,
      var(--color-border-primary, light-dark(#d8dee6, #3c424a))
    );
    --rl-primary: var(
      --a2ui-color-primary,
      var(--color-ring-primary, light-dark(#1a66d2, #7cb4ff))
    );
    --rl-primary-soft: light-dark(rgba(26, 102, 210, 0.11), rgba(124, 180, 255, 0.16));
    --rl-good: light-dark(#137333, #6dd58c);
    --rl-good-soft: light-dark(rgba(19, 115, 51, 0.11), rgba(109, 213, 140, 0.16));
    --rl-warn: light-dark(#b06000, #fbbc04);
    --rl-warn-soft: light-dark(rgba(176, 96, 0, 0.12), rgba(251, 188, 4, 0.16));
    --rl-danger: light-dark(#c5221f, #f28b82);
    --rl-danger-soft: light-dark(rgba(197, 34, 31, 0.11), rgba(242, 139, 130, 0.16));
    --rl-radius: var(--a2ui-border-radius, var(--border-radius-md, 10px));
    --rl-font: var(--font-sans, system-ui, -apple-system, sans-serif);
    --rl-mono: var(--a2ui-font-family-monospace, var(--font-mono, ui-monospace, monospace));
    box-sizing: border-box;
    font-family: var(--rl-font);
    color: var(--rl-text);
  }
`;
