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
 * The styles of the basic catalog components, keyed by the literal
 * `a2ui-*` class names the components render (the naming convention shared
 * with the Angular and Lit basic catalogs).
 *
 * The rules are shipped as a string and adopted at runtime through
 * `injectBasicCatalogComponentStyles` so the published package styles
 * itself without any bundler support or manual stylesheet import.
 */
export const BASIC_CATALOG_CSS = `
.a2ui-button {
  --_a2ui-text-margin: 0;
  --_a2ui-text-color: var(--a2ui-color-on-secondary, #333);
  padding: var(--a2ui-button-padding, var(--a2ui-spacing-m, 0.5rem) var(--a2ui-spacing-l, 1rem));
  margin: var(--a2ui-button-margin, var(--a2ui-spacing-m));
  background: var(--a2ui-button-background, var(--a2ui-color-surface, #fff));
  box-shadow: var(--a2ui-button-box-shadow, none);
  font-weight: var(--a2ui-button-font-weight, normal);
  color: var(--a2ui-color-on-secondary, #333);
  border: var(
    --a2ui-button-border,
    var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
  );
  border-radius: var(--a2ui-button-border-radius, var(--a2ui-border-radius, 8px));
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.a2ui-button:hover {
  background-color: var(--a2ui-color-secondary-hover, #ddd);
}

.a2ui-button.primary {
  --_a2ui-text-color: var(--a2ui-color-on-primary, #fff);
  background-color: var(--a2ui-color-primary, #17e);
  border: none;
  color: var(--_a2ui-text-color);
}

.a2ui-button.primary:hover {
  background-color: var(--a2ui-color-primary-hover, #fbd);
}

.a2ui-button.borderless {
  background: none;
  padding: 0;
  color: var(--a2ui-color-primary, #17e);
  border: none;
}

.a2ui-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.a2ui-text {
  display: inline-block;
  color: var(--_a2ui-text-color, var(--a2ui-text-color-text, var(--a2ui-color-on-background)));
  margin: var(--_a2ui-text-margin, 0);
  box-sizing: border-box;
}

.a2ui-caption {
  display: inline-block;
  color: var(--a2ui-text-caption-color, light-dark(#666, #aaa));
  text-align: left;
  margin: var(--_a2ui-text-margin, 0);
  box-sizing: border-box;
}

.a2ui-text p,
.a2ui-text h1,
.a2ui-text h2,
.a2ui-text h3,
.a2ui-text h4,
.a2ui-text h5,
.a2ui-text h6,
.a2ui-text ol,
.a2ui-text ul,
.a2ui-text li,
.a2ui-text blockquote,
.a2ui-text pre {
  margin: var(--_a2ui-text-margin, 0);
}

.a2ui-text h1,
.a2ui-text h2,
.a2ui-text h3,
.a2ui-text h4,
.a2ui-text h5 {
  font-family: var(--a2ui-font-family-title, inherit);
  line-height: var(--a2ui-line-height-headings, 1.2);
}

.a2ui-text h1 {
  font-size: var(--a2ui-font-size-2xl);
}
.a2ui-text h2 {
  font-size: var(--a2ui-font-size-xl);
}
.a2ui-text h3 {
  font-size: var(--a2ui-font-size-l);
}
.a2ui-text p,
.a2ui-text h4 {
  font-size: var(--a2ui-font-size-m);
}
.a2ui-text h5 {
  font-size: var(--a2ui-font-size-s);
}

.a2ui-text p,
.a2ui-text ol,
.a2ui-text ul,
.a2ui-text li,
.a2ui-text blockquote {
  line-height: var(--a2ui-line-height-body, 1.5);
}

.a2ui-text a {
  color: var(--a2ui-text-a-color, inherit);
  font-weight: var(--a2ui-text-a-font-weight, inherit);
}

.a2ui-text-field-container {
  display: flex;
  flex-direction: column;
  gap: var(--a2ui-spacing-xs, 0.25rem);
  width: 100%;
}

.a2ui-text-field-container .a2ui-field-label {
  font-size: var(
    --a2ui-textfield-label-font-size,
    var(--a2ui-label-font-size, var(--a2ui-font-size-s))
  );
  font-weight: var(--a2ui-textfield-label-font-weight, var(--a2ui-label-font-weight, bold));
}

.a2ui-field-input {
  background-color: var(--a2ui-color-input, #fff);
  color: var(--a2ui-color-on-input, #333);
  border: var(
    --a2ui-textfield-border,
    var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
  );
  border-radius: var(--a2ui-textfield-border-radius, var(--a2ui-spacing-m, 8px));
  padding: var(--a2ui-textfield-padding, var(--a2ui-spacing-m, 0.5rem));
  font-family: inherit;
  box-sizing: border-box;
  width: 100%;
  transition: border-color 0.2s;
}

.a2ui-field-input:hover {
  border-color: var(--a2ui-textfield-color-border-hover, var(--a2ui-color-border-hover, #999));
}

.a2ui-field-input:focus {
  outline: none;
  border-color: var(--a2ui-textfield-color-border-focus, var(--a2ui-color-primary, #17e));
}

.a2ui-field-input.invalid {
  border-color: var(--a2ui-textfield-color-error, red) !important;
}

.a2ui-error-message {
  color: var(--a2ui-textfield-color-error, red);
  font-size: var(--a2ui-font-size-xs, 0.75rem);
}

.a2ui-choice-picker {
  display: flex;
  flex-direction: column;
  gap: var(--a2ui-spacing-s, 0.5rem);
  width: 100%;
}

.a2ui-choice-picker .a2ui-field-label {
  font-size: var(
    --a2ui-choicepicker-label-font-size,
    var(--a2ui-label-font-size, var(--a2ui-font-size-s))
  );
  font-weight: var(--a2ui-choicepicker-label-font-weight, var(--a2ui-label-font-weight, bold));
  color: var(--a2ui-choicepicker-label-color, inherit);
}

.a2ui-filter-input {
  background-color: var(--a2ui-color-input, #fff);
  color: var(--a2ui-color-on-input, #333);
  border: var(
    --a2ui-textfield-border,
    var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
  );
  border-radius: var(--a2ui-textfield-border-radius, var(--a2ui-spacing-m, 8px));
  padding: var(
    --a2ui-choicepicker-filter-padding,
    var(--a2ui-spacing-xs, 4px) var(--a2ui-spacing-s, 8px)
  );
  font-family: inherit;
  transition: border-color 0.2s;
}

.a2ui-filter-input:hover {
  border-color: var(--a2ui-textfield-color-border-hover, var(--a2ui-color-border-hover, #999));
}

.a2ui-filter-input:focus {
  outline: none;
  border-color: var(--a2ui-textfield-color-border-focus, var(--a2ui-color-primary, #17e));
}

.a2ui-options-group {
  display: flex;
  flex-direction: column;
  gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
}

.a2ui-options-group.a2ui-chips-group {
  flex-direction: row;
  flex-wrap: wrap;
}

.a2ui-chip {
  padding: var(
    --a2ui-choicepicker-chip-padding,
    var(--a2ui-spacing-s, 4px) var(--a2ui-spacing-m, 8px)
  );
  border-radius: var(--a2ui-choicepicker-chip-border-radius, 999px);
  border: 1px solid var(--a2ui-color-border, #ccc);
  background-color: var(--a2ui-color-surface, #fff);
  color: var(--a2ui-color-on-surface, inherit);
  cursor: pointer;
  font-size: var(--a2ui-font-size-xs, 0.75rem);
  font-family: inherit;
  transition:
    background-color 0.2s,
    border-color 0.2s;
}

.a2ui-chip.selected {
  background-color: var(--a2ui-color-primary, #007bff);
  color: var(--a2ui-color-on-primary, #fff);
  border-color: var(--a2ui-color-primary, #007bff);
}

.a2ui-option-label {
  display: flex;
  align-items: center;
  gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
  cursor: pointer;
}

.a2ui-option-text {
  font-size: var(--a2ui-font-size-m, 1rem);
}
`;

/**
 * Caches the component stylesheet so it is only created once per document.
 */
let componentStyleSheet: CSSStyleSheet | undefined;

function getComponentStyleSheet(): CSSStyleSheet {
  if (!componentStyleSheet) {
    componentStyleSheet = new CSSStyleSheet();
    componentStyleSheet.replaceSync(BASIC_CATALOG_CSS);
  }
  return componentStyleSheet;
}

/**
 * Injects the basic catalog component rules into the document, mirroring
 * how `injectBasicCatalogStyles` from `@a2ui/web_core` injects the shared
 * design tokens.
 */
export function injectBasicCatalogComponentStyles() {
  if (typeof document === 'undefined') return;
  const docSheets = document.adoptedStyleSheets;
  if (!docSheets || typeof docSheets.includes !== 'function') return;
  const sheet = getComponentStyleSheet();
  if (!docSheets.includes(sheet)) {
    try {
      document.adoptedStyleSheets = [...docSheets, sheet];
    } catch {
      // The document does not support constructable stylesheets.
    }
  }
}
