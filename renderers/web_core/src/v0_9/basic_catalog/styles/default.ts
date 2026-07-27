/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The actual CSS markup of the default A2UI theme.
 *
 * This should be only variable definitions, so they can pierce into the
 * shadow DOM of components.
 *
 * It uses `:where()` to ensure zero specificity, allowing page styles to
 * override these defaults as needed without having to deal with specificity.
 *
 * By default, the theme follows the user's `color-scheme` preference, but
 * developers can force either the light/dark variants using the `a2ui-light`
 * or `a2ui-dark` classes on the root element of their app.
 */
const DEFAULT_CSS = `
  :where(:root) {
    color-scheme: light dark;
  }

  :where(.a2ui-dark) {
    color-scheme: dark;
  }

  :where(.a2ui-light) {
    color-scheme: light;
  }

  :where(:root), :where(.a2ui-dark), :where(.a2ui-light) {
    --a2ui-color-background: light-dark(#eee, #111);
    --a2ui-color-on-background: light-dark(#333, #eee);

    --a2ui-color-surface: light-dark(
      color-mix(in oklab, var(--a2ui-color-background) 85%, white),
      color-mix(in oklab, var(--a2ui-color-background) 95%, white)
    );
    --a2ui-color-on-surface: light-dark(#333, #eee);

    --a2ui-color-primary: #17e;
    --a2ui-color-primary-light: ${computeColorVariant('light', {colorVar: '--a2ui-color-primary'})};
    --a2ui-color-primary-dark: ${computeColorVariant('dark', {colorVar: '--a2ui-color-primary'})};
    --a2ui-color-primary-hover: ${computeColorVariant('hover', {darkVar: '--a2ui-color-primary-dark', lightVar: '--a2ui-color-primary-light'})};
    --a2ui-color-on-primary: #fff;

    --a2ui-color-secondary: light-dark(#ddd, #333);
    --a2ui-color-secondary-light: ${computeColorVariant('light', {colorVar: '--a2ui-color-secondary'})};
    --a2ui-color-secondary-dark: ${computeColorVariant('dark', {colorVar: '--a2ui-color-secondary', percentage: 95})};
    --a2ui-color-secondary-hover: ${computeColorVariant('hover', {darkVar: '--a2ui-color-secondary-dark', lightVar: '--a2ui-color-secondary-light'})};
    --a2ui-color-on-secondary: light-dark(#333, #eee);

    --a2ui-border-radius: 0.25rem;
    --a2ui-color-border: light-dark(#ccc, #444);
    --a2ui-border-width: 1px;
    --a2ui-border: 1px solid var(--a2ui-color-border, #ccc);

    --a2ui-font-family-title: inherit;
    --a2ui-font-family-monospace: monospace;
    --a2ui-color-input: light-dark(#fff, #2a2a2a);
    --a2ui-color-on-input: light-dark(#333, #eee);

    --a2ui-grid-base: 0.5rem;
    --a2ui-spacing-xs: calc(var(--a2ui-spacing-s) / 2);
    --a2ui-spacing-s: calc(var(--a2ui-spacing-m) / 2);
    --a2ui-spacing-m: var(--a2ui-grid-base);
    --a2ui-spacing-l: calc(var(--a2ui-spacing-m) * 2);
    --a2ui-spacing-xl: calc(var(--a2ui-spacing-l) * 2);

    --a2ui-font-size: 1rem;
    --a2ui-font-scale: 1.2;
    --a2ui-font-size-xs: calc(var(--a2ui-font-size-s) / var(--a2ui-font-scale));
    --a2ui-font-size-s: calc(var(--a2ui-font-size-m) / var(--a2ui-font-scale));
    --a2ui-font-size-m: var(--a2ui-font-size);
    --a2ui-font-size-l: calc(var(--a2ui-font-size-m) * var(--a2ui-font-scale));
    --a2ui-font-size-xl: calc(var(--a2ui-font-size-l) * var(--a2ui-font-scale));
    --a2ui-font-size-2xl: calc(var(--a2ui-font-size-xl) * var(--a2ui-font-scale));

    --a2ui-line-height-headings: 1.2;
    --a2ui-line-height-body: 1.5;
  }
`;

/**
 * Caches the default stylesheet so it is only created once.
 */
let defaultStyleSheet: CSSStyleSheet | undefined;

/**
 * Retrieves the default CSSStyleSheet for A2UI components.
 *
 * If the stylesheet doesn't exist, it creates and initializes one with default
 * theme variables from the DEFAULT_CSS string.
 *
 * @returns The default CSSStyleSheet used by A2UI.
 */
function getDefaultStyleSheet(): CSSStyleSheet {
  if (!defaultStyleSheet) {
    defaultStyleSheet = new CSSStyleSheet();
    defaultStyleSheet.replaceSync(DEFAULT_CSS);
  }
  return defaultStyleSheet;
}

/**
 * Injects CSS variables for the A2UI basic catalog into the document.
 *
 * This method is used by the A2UI-provided basic catalogs of each renderer
 * so design token values can be shared across all of them.
 *
 * It is only meant to be used by the basic catalog implementations provided
 * by `@a2ui/lit`, `@a2ui/angular` and `@a2ui/react`, and should not be
 * considered as part of the A2UI spec. This package is just a convenient
 * location for it.
 *
 * Users may redefine the values of the CSS variables exposed in the default
 * stylesheet above (and the specific ones exposed by each basic catalog
 * package) to customize the appearance of the items of the basic catalog.
 */
export function injectBasicCatalogStyles() {
  if (typeof document === 'undefined') return;
  const sheet = getDefaultStyleSheet();
  if (!document.adoptedStyleSheets.includes(sheet)) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
}

/**
 * Options for computing light and dark color variants.
 */
export interface ColorVariantLightDarkOptions {
  /** The CSS variable name of the base color (e.g., '--a2ui-color-primary'). */
  colorVar: string;
  /** The percentage of the base color to retain in the mix (default 85). */
  percentage?: number;
  /** The color to mix with (default 'white' for light, 'black' for dark). */
  mixColor?: string;
}

/**
 * Options for computing hover color variants using light-dark().
 */
export interface ColorVariantHoverOptions {
  /** The CSS variable name of the dark variant. */
  darkVar: string;
  /** The CSS variable name of the light variant. */
  lightVar: string;
}

/**
 * Computes the formula for light or dark variants of a color.
 * @param type The type of variant to compute ('light' or 'dark').
 * @param options Options containing the base color variable and optional percentage.
 * @returns The CSS formula string.
 */
export function computeColorVariant(
  type: 'light' | 'dark',
  options: ColorVariantLightDarkOptions,
): string;

/**
 * Computes the formula for hover variants of a color.
 * @param type The type of variant to compute ('hover').
 * @param options Options containing the dark and light variant variable names.
 * @returns The CSS formula string.
 */
export function computeColorVariant(type: 'hover', options: ColorVariantHoverOptions): string;

/**
 * Computes the formula for light, dark, or hover variants of a color.
 * By default, light variants are mixed with white and dark variants with black.
 * @param type The type of variant to compute ('light', 'dark', 'hover').
 * @param options Options containing variable names, percentages, and optional mix color.
 * @returns The CSS formula string.
 */
export function computeColorVariant(
  type: 'light' | 'dark' | 'hover',
  options: ColorVariantLightDarkOptions | ColorVariantHoverOptions,
): string {
  switch (type) {
    case 'light': {
      const opt = options as ColorVariantLightDarkOptions;
      return `color-mix(in oklab, var(${opt.colorVar}) ${opt.percentage ?? 85}%, ${opt.mixColor ?? 'white'})`;
    }
    case 'dark': {
      const opt = options as ColorVariantLightDarkOptions;
      return `color-mix(in oklab, var(${opt.colorVar}) ${opt.percentage ?? 85}%, ${opt.mixColor ?? 'black'})`;
    }
    case 'hover': {
      const opt = options as ColorVariantHoverOptions;
      return `light-dark(var(${opt.darkVar}), var(${opt.lightVar}))`;
    }
  }
}
