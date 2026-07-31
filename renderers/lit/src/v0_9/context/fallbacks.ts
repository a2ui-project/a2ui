/*
 * Copyright 2026 Google LLC
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

import {createContext} from '@lit/context';
import {nothing, type TemplateResult} from 'lit';
import type {A2uiFallbackInfo, A2uiFallbackState} from '@a2ui/web_core/v0_9';

/**
 * A fallback value: a static template, `nothing`, or a function of the state's
 * fallback info. The Lit analog of React's `A2uiFallbackRenderer`.
 */
export type A2uiLitFallbackRenderer<S extends A2uiFallbackState = A2uiFallbackState> =
  | TemplateResult
  | typeof nothing
  | ((info: Extract<A2uiFallbackInfo, {state: S}>) => TemplateResult | typeof nothing);

/**
 * Consumer-provided fallbacks, one per shared fallback state.
 *
 * There is no `error` key: the `error` state is dispatch-only (reported to the
 * agent via `SurfaceModel.dispatchError`), matching the React and Angular
 * renderers.
 */
export interface A2uiLitFallbacks {
  loading?: A2uiLitFallbackRenderer<'loading'>;
  unknownComponent?: A2uiLitFallbackRenderer<'unknownComponent'>;
}

/**
 * The consumer-fallbacks context.
 *
 * `<a2ui-surface>` `@provide`s it; descendant `A2uiLitElement`s `@consume` it so
 * nested pending/unknown children can render consumer-supplied fallback UI.
 */
export const fallbacks = createContext<A2uiLitFallbacks | undefined>(Symbol('A2UIFallbacks'));

/**
 * Resolves a fallback renderer against its info payload.
 *
 * Returns `nothing` when the renderer is undefined, invokes it with `info` when
 * it is a function, and otherwise returns the static template as-is. The Lit
 * analog of React's `renderFallback`; reused by both the pure-function
 * unknownComponent path and the base element's loading guard.
 */
export function renderFallback<S extends A2uiFallbackState>(
  renderer: A2uiLitFallbackRenderer<S> | undefined,
  info: Extract<A2uiFallbackInfo, {state: S}>,
): TemplateResult | typeof nothing {
  if (renderer === undefined) return nothing;
  if (typeof renderer === 'function') return renderer(info);
  return renderer;
}
