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

import {createContext, useContext} from 'react';
import type React from 'react';
import type {A2uiFallbackInfo, A2uiFallbackState} from '@a2ui/web_core/v0_9';

/** A fallback value: a static node, or a function of the state's fallback info. */
export type A2uiFallbackRenderer<S extends A2uiFallbackState = A2uiFallbackState> =
  | React.ReactNode
  | ((info: Extract<A2uiFallbackInfo, {state: S}>) => React.ReactNode);

/** Consumer-provided fallbacks, one per shared fallback state. */
export interface A2uiFallbacks {
  loading?: A2uiFallbackRenderer<'loading'>;
  unknownComponent?: A2uiFallbackRenderer<'unknownComponent'>;
}

export const FallbackContext = createContext<A2uiFallbacks | undefined>(undefined);

export const useFallbacks = () => useContext(FallbackContext);
