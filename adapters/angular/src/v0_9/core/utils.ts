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

import {DestroyRef, Signal, signal as angularSignal} from '@angular/core';
import {Signal as PreactSignal, effect, signal as preactSignal} from '@a2ui/web_core/v0_9';
export {preactSignal};

/**
 * Bridges a Preact Signal (from A2UI web_core) to a reactive Angular Signal.
 *
 * This utility handles the lifecycle mapping between Preact and Angular,
 * ensuring that updates from the A2UI data model are propagated correctly
 * to Angular's change detection, and resources are cleaned up when the
 * component is destroyed.
 *
 * @param preactSignal The source Preact Signal.
 * @param destroyRef Angular DestroyRef for lifecycle management.
 * @param ngZone Optional NgZone to ensure updates run within the Angular zone
 *               (necessary for correct change detection in OnPush components).
 * @returns A read-only Angular Signal.
 */
import {NgZone} from '@angular/core';

export function toAngularSignal<T>(
  preactSignal: PreactSignal<T>,
  destroyRef: DestroyRef,
  ngZone?: NgZone,
): Signal<T> {
  const s = angularSignal(preactSignal.peek());

  const dispose = effect(() => {
    if (ngZone) {
      ngZone.run(() => s.set(preactSignal.value));
    } else {
      s.set(preactSignal.value);
    }
  });

  destroyRef.onDestroy(() => {
    dispose();
    // Some signals returned by DataContext.resolveSignal have a custom unsubscribe for AbortControllers
    if ((preactSignal as any).unsubscribe) {
      (preactSignal as any).unsubscribe();
    }
  });

  return s.asReadonly();
}

/**
 * Normalizes a data model path by combining a relative path with a base context.
 *
 * This is used to create unique absolute paths for components within a repeating
 * collection or nested structure.
 *
 * @param path The relative or absolute path from the component properties.
 * @param dataContextPath The current base data context path.
 * @param index The index of the child component.
 * @returns A fully normalized absolute path for the indexed child.
 */
export function getNormalizedPath(
  path: string | undefined,
  dataContextPath: string,
  index: number,
): string {
  let normalized = path || '';
  if (!normalized.startsWith('/')) {
    const base = dataContextPath === '/' ? '' : dataContextPath;
    normalized = `${base}/${normalized}`;
  }
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return `${normalized}/${index}`;
}
