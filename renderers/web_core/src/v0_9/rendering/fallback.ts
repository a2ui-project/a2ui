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

/**
 * Shared fallback contract for A2UI framework renderers (React, Lit, Angular).
 *
 * Renderers encounter three states in which a component cannot be rendered:
 *
 * - `loading`: a component id is referenced by its parent but the component
 *   has not yet been streamed to the client (`SurfaceComponentsModel.get`
 *   returns `undefined`). The component may arrive in a later
 *   `updateComponents` message.
 * - `unknownComponent`: the component model exists, but its `type` has no
 *   implementation in the surface's catalog (`catalog.components.get`
 *   returns `undefined`).
 * - `error`: a runtime exception occurred while rendering (for example, a
 *   failing function call). `reason` carries the thrown value.
 *
 * Renderers MUST render nothing by default in these states, and MAY offer a
 * framework-idiomatic mechanism for consumers to provide custom fallback UI.
 * These types define the shared vocabulary for those mechanisms. Renderers
 * SHOULD report `unknownComponent` and `error` to the agent via
 * `SurfaceModel.dispatchError` with a structured code.
 */

/** Information describing why a fallback is being rendered. */
export type A2uiFallbackInfo =
  | {
      /** The component is referenced but has not yet been streamed to the client. */
      state: 'loading';
      /** The id of the component that could not be rendered. */
      componentId: string;
      /** The `type` of the component that instantiated this one. Absent at the surface root. */
      parentComponentType?: string;
    }
  | {
      /** The component's `type` has no implementation in the surface's catalog. */
      state: 'unknownComponent';
      /** The id of the component that could not be rendered. */
      componentId: string;
      /** The component's declared type. */
      componentType: string;
      /** The `type` of the component that instantiated this one. Absent at the surface root. */
      parentComponentType?: string;
    }
  | {
      /** A runtime exception occurred while rendering the component. */
      state: 'error';
      /** The id of the component that could not be rendered. */
      componentId: string;
      /** The thrown value. If it is an `Error`, the stack is available on it. */
      reason: unknown;
      /** The `type` of the component that instantiated this one. Absent at the surface root. */
      parentComponentType?: string;
    };

/** The fallback states shared across all A2UI framework renderers. */
export type A2uiFallbackState = A2uiFallbackInfo['state'];
