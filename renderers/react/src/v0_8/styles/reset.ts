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

/**
 * Browser default reset for A2UI surfaces.
 *
 * The React renderer uses Light DOM, which means host-app CSS resets
 * (e.g. Tailwind preflight, normalize.css) can strip browser defaults
 * like heading margins, list styles, and form element appearance from
 * elements inside the renderer.
 *
 * The Lit renderer avoids this because Shadow DOM isolates its elements
 * from external stylesheets.
 *
 * This reset restores browser defaults inside `.a2ui-surface` by using
 * `all: revert` in a CSS @layer. Layered styles have the lowest author
 * priority, so every other A2UI style (utility classes, component styles,
 * theme classes, inline styles) automatically overrides the reset.
 */
export const resetStyles: string = `
@layer a2ui-reset {
  :where(.a2ui-surface) :where(*:not(svg, svg *:not(foreignObject *))) {
    all: revert;
  }
}
`;
