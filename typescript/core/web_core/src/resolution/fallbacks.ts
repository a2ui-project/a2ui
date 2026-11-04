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

import type {ComponentNode} from './component-node.js';

/** What a `pending` fallback gets: a component that may still arrive. */
export interface A2uiPendingInfo {
  /** The id of the component that has not arrived (the surface's root id before the root arrives). */
  componentId: string;
  /** The type of the component whose child this is. Absent for the root. */
  parentComponentType?: string;
}

/** Why a node is in error. */
export interface A2uiFallbackError {
  /** Open-ended: `'unknown-type'` | `'cyclic'` | `'unresolved-reference'` | kinds added later. */
  type: string;
  /** The declared type, for `'unknown-type'`. */
  componentType?: string;
}

/** What an `error` fallback gets: a component that will not render unless the agent changes it. */
export interface A2uiErrorInfo {
  componentId: string;
  parentComponentType?: string;
  error: A2uiFallbackError;
}

/**
 * The UI a surface shows for nodes that can't render yet (`pending`) or at all (`error`), in
 * the framework's view type `V`. A missing category, or a builder that returns null or
 * undefined, renders nothing and takes no layout space.
 */
export interface A2uiFallbacks<V> {
  /** Returns the view for a pending node, or null/undefined to render nothing. */
  pending?: (info: A2uiPendingInfo) => V | null | undefined;
  /** Returns the view for a node in error, or null/undefined to render nothing. */
  error?: (info: A2uiErrorInfo) => V | null | undefined;
}

/** A fallback category with the `info` its builder gets. */
export type A2uiFallbackRequest =
  | {category: 'pending'; info: A2uiPendingInfo}
  | {category: 'error'; info: A2uiErrorInfo};

/** The request for the surface's root before it arrives. */
export function rootPendingRequest(rootId: string): A2uiFallbackRequest {
  return {category: 'pending', info: {componentId: rootId}};
}

/**
 * The fallback request for `node`, or `undefined` when it has resolved or was disposed.
 *
 * @param parentComponentType The type of the component rendering `node`; omit for the root.
 */
export function fallbackRequestFor(
  node: ComponentNode,
  parentComponentType?: string,
): A2uiFallbackRequest | undefined {
  if (node.disposed) return undefined;
  const base = {
    componentId: node.componentId,
    ...(parentComponentType !== undefined ? {parentComponentType} : {}),
  };
  switch (node.state) {
    case 'pending':
      return {category: 'pending', info: base};
    case 'unknown-type':
      return {
        category: 'error',
        info: {...base, error: {type: 'unknown-type', componentType: node.type}},
      };
    case 'cyclic':
      return {category: 'error', info: {...base, error: {type: 'cyclic'}}};
    default:
      return undefined;
  }
}

/**
 * Runs the builder `fallbacks` has for `request`. Returns `undefined` when there is none, when
 * it returns null or undefined, or when it throws: a throwing builder is logged and its node
 * renders nothing. Builders don't report errors; the resolver or adapter already has.
 */
export function buildFallback<V>(
  fallbacks: A2uiFallbacks<V> | undefined,
  request: A2uiFallbackRequest,
): V | undefined {
  try {
    const view =
      request.category === 'pending'
        ? fallbacks?.pending?.(request.info)
        : fallbacks?.error?.(request.info);
    return view ?? undefined;
  } catch (e) {
    console.error(`A2UI ${request.category} fallback for '${request.info.componentId}' threw:`, e);
    return undefined;
  }
}
