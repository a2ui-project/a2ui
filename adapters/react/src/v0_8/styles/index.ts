/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as Styles from '@a2ui/web_core/styles/index';
import {resetStyles} from './reset';

/**
 * Structural CSS styles from the Lit renderer, converted for global DOM use.
 * These styles define all the utility classes (layout-*, typography-*, color-*, etc.)
 * Converts :host selectors to .a2ui-surface for scoped use outside Shadow DOM.
 */
export const structuralStyles: string = Styles.structuralStyles.replace(
  /:host\s*\{/g,
  '.a2ui-surface {',
);

/**
 * Component-specific styles that replicate Lit's Shadow DOM scoped CSS.
 *
 * Each Lit component has `static styles` with :host, element selectors, and ::slotted().
 * Since React uses Light DOM, we transform these to global CSS scoped under .a2ui-surface.
 *
 * Transformation rules:
 *   :host          → .a2ui-surface .a2ui-{component}
 *   section        → .a2ui-surface .a2ui-{component} > section
 *   ::slotted(*)   → .a2ui-surface .a2ui-{component} > section > *
 *
 * The `>` child combinator is used throughout to prevent selectors from matching
 * elements inside nested components (e.g. a Column's section rule must not match
 * a CheckBox's section that happens to be a descendant).
 *
 * Element selectors that should remain overridable by theme utility classes use
 * `:where()` to keep specificity at zero (e.g. `:where(.a2ui-surface .a2ui-text) h1`),
 * matching the low specificity of Lit's Shadow DOM element selectors.
 */
export const componentSpecificStyles: string = `
.a2ui-surface .a2ui-card {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}
.a2ui-surface .a2ui-card > section {
  height: 100%;
  width: 100%;
  min-height: 0;
  overflow: auto;
}
.a2ui-surface .a2ui-card > section > * {
  height: 100%;
  width: 100%;
}

.a2ui-surface .a2ui-divider {
  display: block;
  min-height: 0;
  overflow: auto;
}
:where(.a2ui-surface .a2ui-divider) hr {
  height: 1px;
  background: #ccc;
  border: none;
}

.a2ui-surface .a2ui-text {
  display: block;
  flex: var(--weight);
}
:where(.a2ui-surface .a2ui-text) h1,
:where(.a2ui-surface .a2ui-text) h2,
:where(.a2ui-surface .a2ui-text) h3,
:where(.a2ui-surface .a2ui-text) h4,
:where(.a2ui-surface .a2ui-text) h5 {
  line-height: inherit;
  font: inherit;
}
.a2ui-surface .a2ui-text p {
  margin: 0;
}

.a2ui-surface .a2ui-textfield {
  display: flex;
  flex: var(--weight);
}
:where(.a2ui-surface .a2ui-textfield) input {
  display: block;
  width: 100%;
}
:where(.a2ui-surface .a2ui-textfield) label {
  display: block;
  margin-bottom: 4px;
}
:where(.a2ui-surface .a2ui-textfield) textarea {
  display: block;
  width: 100%;
}

.a2ui-surface .a2ui-checkbox {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}
:where(.a2ui-surface .a2ui-checkbox) input {
  display: block;
  width: 100%;
}

.a2ui-surface .a2ui-slider {
  display: block;
  flex: var(--weight);
}
:where(.a2ui-surface .a2ui-slider) input {
  display: block;
  width: 100%;
}

.a2ui-surface .a2ui-button {
  display: block;
  flex: var(--weight);
  min-height: 0;
}

.a2ui-surface .a2ui-icon {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}
:where(.a2ui-surface .a2ui-icon) .g-icon {
  font-size: 24px;
}

.a2ui-surface .a2ui-tabs {
  display: block;
  flex: var(--weight);
}

.a2ui-surface .a2ui-modal {
  display: block;
  flex: var(--weight);
}
:where(.a2ui-surface .a2ui-modal) dialog {
  padding: 0;
  border: none;
  background: none;
}
.a2ui-surface .a2ui-modal dialog section #controls {
  display: flex;
  justify-content: end;
  margin-bottom: 4px;
}
.a2ui-surface .a2ui-modal dialog section #controls button {
  padding: 0;
  background: none;
  width: 20px;
  height: 20px;
  cursor: pointer;
  border: none;
}

.a2ui-surface .a2ui-image {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}
:where(.a2ui-surface .a2ui-image) img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: var(--object-fit, fill);
}

.a2ui-surface .a2ui-video {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}
:where(.a2ui-surface .a2ui-video) video {
  display: block;
  width: 100%;
}

.a2ui-surface .a2ui-audio {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}
:where(.a2ui-surface .a2ui-audio) audio {
  display: block;
  width: 100%;
}

.a2ui-surface .a2ui-multiplechoice {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}
:where(.a2ui-surface .a2ui-multiplechoice) select {
  width: 100%;
}

.a2ui-surface .a2ui-column {
  display: flex;
  flex: var(--weight);
}
.a2ui-surface .a2ui-column > section {
  display: flex;
  flex-direction: column;
  min-width: 100%;
  height: 100%;
}
.a2ui-surface .a2ui-column[data-alignment="start"] > section { align-items: start; }
.a2ui-surface .a2ui-column[data-alignment="center"] > section { align-items: center; }
.a2ui-surface .a2ui-column[data-alignment="end"] > section { align-items: end; }
.a2ui-surface .a2ui-column[data-alignment="stretch"] > section { align-items: stretch; }
.a2ui-surface .a2ui-column[data-distribution="start"] > section { justify-content: start; }
.a2ui-surface .a2ui-column[data-distribution="center"] > section { justify-content: center; }
.a2ui-surface .a2ui-column[data-distribution="end"] > section { justify-content: end; }
.a2ui-surface .a2ui-column[data-distribution="spaceBetween"] > section { justify-content: space-between; }
.a2ui-surface .a2ui-column[data-distribution="spaceAround"] > section { justify-content: space-around; }
.a2ui-surface .a2ui-column[data-distribution="spaceEvenly"] > section { justify-content: space-evenly; }

.a2ui-surface .a2ui-row {
  display: flex;
  flex: var(--weight);
}
.a2ui-surface .a2ui-row > section {
  display: flex;
  flex-direction: row;
  width: 100%;
  min-height: 100%;
}
.a2ui-surface .a2ui-row[data-alignment="start"] > section { align-items: start; }
.a2ui-surface .a2ui-row[data-alignment="center"] > section { align-items: center; }
.a2ui-surface .a2ui-row[data-alignment="end"] > section { align-items: end; }
.a2ui-surface .a2ui-row[data-alignment="stretch"] > section { align-items: stretch; }
.a2ui-surface .a2ui-row[data-distribution="start"] > section { justify-content: start; }
.a2ui-surface .a2ui-row[data-distribution="center"] > section { justify-content: center; }
.a2ui-surface .a2ui-row[data-distribution="end"] > section { justify-content: end; }
.a2ui-surface .a2ui-row[data-distribution="spaceBetween"] > section { justify-content: space-between; }
.a2ui-surface .a2ui-row[data-distribution="spaceAround"] > section { justify-content: space-around; }
.a2ui-surface .a2ui-row[data-distribution="spaceEvenly"] > section { justify-content: space-evenly; }

.a2ui-surface .a2ui-list {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}
.a2ui-surface .a2ui-list[data-direction="vertical"] > section {
  display: grid;
}
.a2ui-surface .a2ui-list[data-direction="horizontal"] > section {
  display: flex;
  max-width: 100%;
  overflow-x: scroll;
  overflow-y: hidden;
  scrollbar-width: none;
}
.a2ui-surface .a2ui-list[data-direction="horizontal"] > section > * {
  flex: 1 0 fit-content;
  max-width: min(80%, 400px);
}

.a2ui-surface .a2ui-datetime-input {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}
:where(.a2ui-surface .a2ui-datetime-input) input {
  display: block;
  border-radius: 8px;
  padding: 8px;
  border: 1px solid #ccc;
  width: 100%;
}

.a2ui-surface *,
.a2ui-surface *::before,
.a2ui-surface *::after {
  box-sizing: border-box;
}
`;

/**
 * Injects A2UI structural styles into the document head.
 * Includes utility classes (layout-*, typography-*, color-*, etc.) and React-specific overrides.
 * Call this once at application startup.
 *
 * NOTE: CSS variables (--n-*, --p-*, etc.) must be defined by the host application on :root,
 * just like in the Lit renderer. This allows full customization of the color palette.
 *
 * @example
 * ```tsx
 * import { injectStyles } from '@a2ui/react/styles';
 *
 * // In your app entry point:
 * injectStyles();
 * ```
 */
export function injectStyles(): void {
  if (typeof document === 'undefined') {
    return; // SSR safety
  }

  const styleId = 'a2ui-structural-styles';

  // Avoid duplicate injection
  if (document.getElementById(styleId)) {
    return;
  }

  const styleElement = document.createElement('style');
  styleElement.id = styleId;
  // Include structural (utility classes) and component-specific styles
  // Note: CSS variables (palette) must be defined by the host application on :root,
  // just like in the Lit renderer. This allows full customization.
  styleElement.textContent = resetStyles + '\n' + structuralStyles + '\n' + componentSpecificStyles;
  document.head.appendChild(styleElement);
}

/**
 * Removes injected A2UI styles from the document.
 * Useful for cleanup in tests or when unmounting.
 */
export function removeStyles(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const styleElement = document.getElementById('a2ui-structural-styles');
  if (styleElement) {
    styleElement.remove();
  }
}
