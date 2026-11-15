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

import {isDataContext} from './data-context-internal.js';

/**
 * Resolves the 0-based iteration index from a context or its ancestor chain.
 *
 * Checks for an explicit index first, then checks whether the trailing
 * segment of the data path is numeric, walking the parent context chain until a
 * match is found.
 *
 * @param startCtx Initial context or context-like object to inspect.
 * @returns The resolved 0-based iteration index, or `undefined` if outside an iteration scope.
 */
export function resolveContextIndex(startCtx: unknown): number | undefined {
  let ctx = startCtx as
    | {
        explicitIndex?: number;
        getIndex?: () => number | undefined;
        index?: number;
        path?: string;
        parent?: unknown;
      }
    | undefined;
  while (ctx) {
    if (ctx.explicitIndex !== undefined && Number.isFinite(ctx.explicitIndex)) {
      return ctx.explicitIndex;
    }
    if (!isDataContext(ctx) && typeof ctx.getIndex === 'function') {
      const idx = ctx.getIndex();
      if (idx !== undefined && Number.isFinite(idx)) {
        return idx;
      }
    }
    if (!isDataContext(ctx) && typeof ctx.index === 'number' && Number.isFinite(ctx.index)) {
      return ctx.index;
    }
    if (typeof ctx.path === 'string') {
      const parts = ctx.path.split('/').filter(Boolean);
      if (parts.length > 0 && /^\d+$/.test(parts[parts.length - 1])) {
        return parseInt(parts[parts.length - 1], 10);
      }
    }
    ctx = ctx.parent as typeof ctx;
  }
  return undefined;
}
