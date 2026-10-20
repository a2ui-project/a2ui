/*
 * Copyright 2024 Google LLC
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

export type {LitComponentApi} from './types.js';
export {A2uiSurface} from './surface/a2ui-surface.js';
export {renderA2uiNode} from './surface/render-a2ui-node.js';
export {A2uiLitElement} from './a2ui-lit-element.js';
export {A2uiController} from './a2ui-controller.js';
export {Context} from './context/context.js';

/**
 * @deprecated Import v0.8 from '@a2ui/lit/v0_8'.
 * Maintained for backwards compatibility.
 *
 * This re-exports `./0.8/core.js` rather than `./0.8/index.js` on purpose.
 * `0.8/index.js` also pulls in `0.8/ui/*`, whose `@customElement` decorators
 * register `a2ui-surface`, `a2ui-slider`, `a2ui-card`, and other tags at import
 * time. This entry point registers the version-agnostic `A2uiSurface` under the
 * same `a2ui-surface` tag, and the universal elements in `@a2ui/web_core` use
 * the other tag names, so importing `0.8/index.js` here would throw duplicate
 * `customElements.define` errors. The v0.8 elements remain available from
 * `@a2ui/lit/v0_8`.
 */
export * as v0_8 from './0.8/core.js';
