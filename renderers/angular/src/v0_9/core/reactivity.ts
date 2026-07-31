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

import {
  signal,
  computed,
  effect as angularEffect,
  untracked,
  isSignal,
  Signal as AngularSignal,
  EnvironmentInjector,
  DestroyRef,
  isWritableSignal,
} from '@angular/core';
import {
  SignalImplementations,
  setSignalImplementation,
  Signal,
  _PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION,
} from '@a2ui/web_core/v0_9';

let isAttached = false;

/** Asserts that a value is an Angular signal. */
export function assertAngularSignal<T>(value: unknown): asserts value is AngularSignal<T> {
  if (!isSignal(value)) {
    throw new Error('Received unexpected value. Expected an Angular signal.');
  }
}

/**
 * Configures the A2UI web_core to use Angular's native signals.
 * @param injector The Angular Injector to use for effects.
 */
export function initializeAngularReactivity(injector: EnvironmentInjector): void {
  if (isAttached) {
    return;
  }

  const angularSignalImpl: SignalImplementations = {
    signal: <T>(initialValue: T) => signal(initialValue) as Signal<T>,
    computed: <T>(computeFn: () => T) => computed(computeFn) as Signal<T>,
    effect: (effectFn: () => void | (() => void)) => {
      return untracked(() => {
        let cleanup: (() => void) | void;

        const ref = angularEffect(
          onCleanup => {
            cleanup = effectFn();
            if (cleanup) {
              onCleanup(cleanup);
            }
          },
          {injector},
        );

        return () => ref.destroy();
      });
    },
    batchWrite: (batchFn: () => void) => {
      // Angular signals batch automatically. We just execute the function.
      batchFn();
    },
    isSignal: (val: unknown): val is Signal<unknown> => isSignal(val),
    getValue: <T>(sig: Signal<T>) => (sig as AngularSignal<T>)(),
    setValue: <T>(sig: Signal<T>, value: T) => {
      assertAngularSignal(sig);
      if (isWritableSignal(sig)) {
        sig.set(value);
      }
    },
    peekValue: <T>(sig: Signal<T>) => {
      assertAngularSignal(sig);
      return untracked(() => sig() as T);
    },
  };

  setSignalImplementation(angularSignalImpl);
  isAttached = true;

  // Clean up the implementation since attempting to use a destroyed injector will throw.
  // Note that in practice this will should only happen in tests, in real apps the environment
  // injector is created once and exists during the lifetime of the page.
  injector.get(DestroyRef).onDestroy(() => {
    if (isAttached) {
      setSignalImplementation(_PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION);
      isAttached = false;
    }
  });
}
