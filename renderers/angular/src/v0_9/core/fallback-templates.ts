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

import { InjectionToken, Signal, TemplateRef } from '@angular/core';
import { A2uiFallbackInfo } from '@a2ui/web_core/v0_9';

/**
 * Context passed to consumer-provided fallback templates via `ngTemplateOutlet`.
 */
export interface A2uiFallbackTemplateContext {
  /** The full fallback info payload. */
  $implicit: A2uiFallbackInfo;
  /** The id of the component that could not be rendered. */
  componentId: string;
  /** The component's declared type. Only present for the `unknownComponent` state. */
  componentType?: string;
}

/**
 * Consumer-provided fallback templates, one per shared fallback state.
 * Provided by `SurfaceComponent` from its template inputs; nested
 * `ComponentHostComponent`s inject it optionally.
 */
export interface A2uiFallbackTemplates {
  readonly loadingTemplate: Signal<TemplateRef<A2uiFallbackTemplateContext> | undefined>;
  readonly unknownComponentTemplate: Signal<TemplateRef<A2uiFallbackTemplateContext> | undefined>;
}

/**
 * Injection token delivering fallback templates to component hosts,
 * mirroring `A2UI_RENDERER_CONFIG`.
 */
export const A2UI_FALLBACK_TEMPLATES = new InjectionToken<A2uiFallbackTemplates>(
  'A2UI_FALLBACK_TEMPLATES',
);
