/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  DestroyRef,
  EnvironmentInjector,
  Signal as AngularSignal,
  computed,
  effect as angularEffect,
  isSignal,
  isWritableSignal,
  signal,
  untracked,
} from '@angular/core';
import {
  Signal,
  SignalImplementations,
  _PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION,
  setSignalImplementation,
} from '@a2ui/web_core';

interface MaybeAngularRuntimeError {
  readonly code?: unknown;
}

const activeInjectors = new Set<EnvironmentInjector>();
const registeredInjectors = new WeakSet<EnvironmentInjector>();
let currentInjector: EnvironmentInjector | null = null;
let isAttached = false;

function isInjectorDestroyed(injector: EnvironmentInjector): boolean {
  return Boolean(injector.destroyed);
}

function isDestroyedInjectorError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  if ((err as MaybeAngularRuntimeError).code === -205) {
    return true;
  }
  return err instanceof Error && err.message.includes('NG0205');
}

function syncActiveInjector(): EnvironmentInjector | null {
  let earliest: EnvironmentInjector | null = null;
  for (const inj of activeInjectors) {
    if (isInjectorDestroyed(inj)) {
      activeInjectors.delete(inj);
    } else if (earliest === null) {
      earliest = inj;
    }
  }
  currentInjector = earliest;
  if (currentInjector === null && isAttached) {
    setSignalImplementation(_PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION);
    isAttached = false;
  }
  return currentInjector;
}

function scheduleEffectOnInjector(
  targetInjector: EnvironmentInjector,
  effectFn: () => void | (() => void),
): () => void {
  return untracked(() => {
    let cleanup: (() => void) | void;
    const ref = angularEffect(
      onCleanup => {
        cleanup = effectFn();
        if (cleanup) {
          onCleanup(cleanup);
        }
      },
      {injector: targetInjector},
    );
    return () => ref.destroy();
  });
}

function createAngularEffect(effectFn: () => void | (() => void)): () => void {
  let inj =
    currentInjector && !isInjectorDestroyed(currentInjector)
      ? currentInjector
      : syncActiveInjector();
  while (inj !== null) {
    const targetInjector = inj;
    try {
      return scheduleEffectOnInjector(targetInjector, effectFn);
    } catch (err: unknown) {
      if (!isDestroyedInjectorError(err)) {
        throw err;
      }
      activeInjectors.delete(targetInjector);
      inj = syncActiveInjector();
    }
  }
  return untracked(() => _PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION.effect(effectFn));
}

const angularSignalImpl: SignalImplementations = {
  signal: <T>(initialValue: T) => signal(initialValue) as Signal<T>,
  computed: <T>(computeFn: () => T) => computed(computeFn) as Signal<T>,
  effect: createAngularEffect,
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

/** Asserts that a value is an Angular signal. */
export function assertAngularSignal<T>(value: unknown): asserts value is AngularSignal<T> {
  if (!isSignal(value)) {
    throw new Error('Received unexpected value. Expected an Angular signal.');
  }
}

/**
 * Configures `@a2ui/web_core` to use Angular's native signals.
 *
 * Hosts effects on the earliest initialized `EnvironmentInjector` that remains
 * live, promoting the next live injector only when the current host is
 * destroyed or evicted on `NG0205`. Reverts `@a2ui/web_core` to its default
 * signal implementation once no live injectors remain.
 *
 * @param injector The Angular EnvironmentInjector to register for effect hosting.
 */
export function initializeAngularReactivity(injector: EnvironmentInjector): void {
  syncActiveInjector();
  if (isInjectorDestroyed(injector)) {
    return;
  }

  if (!activeInjectors.has(injector)) {
    activeInjectors.add(injector);
  }
  if (currentInjector === null) {
    currentInjector = injector;
  }

  setSignalImplementation(angularSignalImpl);
  isAttached = true;

  if (!registeredInjectors.has(injector)) {
    registeredInjectors.add(injector);
    injector.get(DestroyRef).onDestroy(() => {
      activeInjectors.delete(injector);
      syncActiveInjector();
    });
  }
}
