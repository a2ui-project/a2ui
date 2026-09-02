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
 * Centralized layout mapping utilities for Web/CSS-based renderers.
 *
 * Maps A2UI layout enum values (e.g., `spaceBetween`) to their corresponding
 * CSS values (e.g., `space-between`). These functions are shared across all
 * web renderers (React, Lit, Angular) to ensure consistent behavior.
 *
 * Contract: nullish input returns `undefined` so consumers leave the CSS
 * property unset (inherits from cascade / CSS variables). Unknown keys are
 * passed through as-is so that future enum additions or spec mismatches
 * remain visible to the browser rather than silently coerced to a default.
 *
 * The maps use `Map` rather than plain objects to avoid prototype-chain
 * lookups (e.g. `mapJustify('toString')` must not hit `Object.prototype`).
 */

const justifyMap = new Map<string, string>([
  ['center', 'center'],
  ['end', 'flex-end'],
  ['spaceAround', 'space-around'],
  ['spaceBetween', 'space-between'],
  ['spaceEvenly', 'space-evenly'],
  ['start', 'flex-start'],
  ['stretch', 'stretch'],
]);

/**
 * Maps an A2UI justify enum value to its CSS `justify-content` equivalent.
 *
 * @param value - An A2UI justify value such as `'start'`, `'center'`,
 *   `'spaceBetween'`, etc.
 * @returns The mapped CSS value, the raw input if the key is unknown, or
 *   `undefined` if the input is nullish.
 */
export function mapJustify(value?: string | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  return justifyMap.get(value) ?? value;
}

const alignMap = new Map<string, string>([
  ['baseline', 'baseline'],
  ['center', 'center'],
  ['end', 'flex-end'],
  ['start', 'flex-start'],
  ['stretch', 'stretch'],
]);

/**
 * Maps an A2UI align enum value to its CSS `align-items` equivalent.
 *
 * @param value - An A2UI align value such as `'start'`, `'center'`, `'end'`,
 *   `'stretch'`, or `'baseline'`.
 * @returns The mapped CSS value, the raw input if the key is unknown, or
 *   `undefined` if the input is nullish.
 */
export function mapAlign(value?: string | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  return alignMap.get(value) ?? value;
}
