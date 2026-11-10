/*
 * Copyright 2026 Google LLC
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

/** Theme tokens sent to the app in `initialize` and `theme/changed` (bridge protocol 3.1). */
export interface ThemeTokens {
  readonly colorScheme: 'light' | 'dark';
  readonly cssVars: Readonly<Record<string, string>>;
}

/**
 * Variables read even when the browser doesn't list custom properties in computed styles: the
 * ones the React renderer's basic catalog uses for colors, type, spacing and borders.
 */
export const DEFAULT_THEME_VARIABLES: readonly string[] = [
  '--a2ui-color-primary',
  '--a2ui-color-primary-hover',
  '--a2ui-color-on-primary',
  '--a2ui-color-secondary',
  '--a2ui-color-on-secondary',
  '--a2ui-color-background',
  '--a2ui-color-on-background',
  '--a2ui-color-surface',
  '--a2ui-color-on-surface',
  '--a2ui-color-border',
  '--a2ui-color-error',
  '--a2ui-font-family',
  '--a2ui-font-family-mono',
  '--a2ui-font-size-xs',
  '--a2ui-font-size-s',
  '--a2ui-font-size-m',
  '--a2ui-font-size-l',
  '--a2ui-font-size-xl',
  '--a2ui-spacing-xs',
  '--a2ui-spacing-s',
  '--a2ui-spacing-m',
  '--a2ui-spacing-l',
  '--a2ui-spacing-xl',
  '--a2ui-border-radius',
  '--a2ui-border-width',
  '--a2ui-text-caption-color',
];

/**
 * Reads the theme of the page at `element`: every `--a2ui-*` custom property in its computed
 * style (they inherit, so the surface's theme applies), plus `extraVariables`. The color scheme is
 * dark when the element's `color-scheme` allows dark and the page prefers it.
 */
export function readThemeTokens(
  element: Element,
  extraVariables: readonly string[] = [],
): ThemeTokens {
  const style = getComputedStyle(element);
  const names = new Set([...DEFAULT_THEME_VARIABLES, ...extraVariables]);
  for (let index = 0; index < style.length; index++) {
    const name = style.item(index);
    if (name.startsWith('--a2ui-')) {
      names.add(name);
    }
  }
  const cssVars: Record<string, string> = {};
  for (const name of [...names].sort()) {
    const value = style.getPropertyValue(name).trim();
    if (value) {
      cssVars[name] = value;
    }
  }
  const allowsDark = /\bdark\b/.test(style.colorScheme || '');
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const onlyDark = allowsDark && !/\blight\b/.test(style.colorScheme || '');
  return {colorScheme: onlyDark || (allowsDark && prefersDark) ? 'dark' : 'light', cssVars};
}
