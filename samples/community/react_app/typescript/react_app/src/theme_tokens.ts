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

/** A font face of a theme font (bridge protocol 3.1). */
export interface ThemeFontFace {
  /** Family name, as the `--a2ui-font-family*` variables use it. */
  readonly family: string;
  /** A CSS `src` value, for example `url(data:font/woff2;base64,…) format("woff2")`, or a URL. */
  readonly src: string;
  /** CSS `font-weight` descriptor, for example `400` or `100 900`. */
  readonly weight?: string;
  /** CSS `font-style` descriptor, for example `italic`. */
  readonly style?: string;
}

/** Theme tokens sent to the app in `initialize` and `theme/changed` (bridge protocol 3.1). */
export interface ThemeTokens {
  readonly colorScheme: 'light' | 'dark';
  readonly cssVars: Readonly<Record<string, string>>;
  readonly fontFaces?: readonly ThemeFontFace[];
}

/** What {@link readThemeTokens} adds to the page's variables; `ReactAppConfig` has both fields. */
export interface ThemeOptions {
  /** CSS custom properties to send besides the `--a2ui-*` ones. */
  readonly themeVariables?: readonly string[];
  /** Font faces to send with the theme. */
  readonly fontFaces?: readonly ThemeFontFace[];
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
  '--a2ui-font-family-title',
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
 * style (they inherit, so the surface's theme applies), plus `options.themeVariables`, and
 * `options.fontFaces`. The color scheme is dark when the element's `color-scheme` allows dark and
 * the page prefers it.
 */
export function readThemeTokens(element: Element, options: ThemeOptions = {}): ThemeTokens {
  const {themeVariables = [], fontFaces = []} = options;
  const style = getComputedStyle(element);
  const names = new Set([...DEFAULT_THEME_VARIABLES, ...themeVariables]);
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
  return {
    colorScheme: onlyDark || (allowsDark && prefersDark) ? 'dark' : 'light',
    cssVars,
    ...(fontFaces.length > 0 ? {fontFaces} : {}),
  };
}
