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
 * Structural CSS styles converted from Lit renderer.
 * Uses .a2ui-surface {} instead of :host {} for non-Shadow DOM usage.
 */
export declare const structuralStyles: string;

/**
 * Component-specific styles that replicate Lit's Shadow DOM scoped CSS.
 * Transforms :host, element selectors, and ::slotted() for Light DOM use.
 */
export declare const componentSpecificStyles: string;

/**
 * Injects A2UI structural styles into the document head.
 * Includes utility classes and React-specific overrides.
 * CSS variables (palette) must be defined by the host on :root.
 */
export declare function injectStyles(): void;

/**
 * Removes the injected A2UI structural styles from the document.
 */
export declare function removeStyles(): void;
