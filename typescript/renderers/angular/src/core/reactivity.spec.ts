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
  ProviderToken,
  createEnvironmentInjector,
  isSignal as isAngularSignal,
} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {
  _PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION,
  effect,
  getValue,
  setSignalImplementation,
  setValue,
  signal,
} from '@a2ui/web_core';
import {assertAngularSignal, initializeAngularReactivity} from './reactivity';

class StubDestroyRef extends DestroyRef {
  private readonly callbacks: Array<() => void> = [];
  private isDestroyedState = false;
  onDestroyRegistrationCount = 0;

  override get destroyed(): boolean {
    return this.isDestroyedState;
  }

  override onDestroy(callback: () => void): () => void {
    this.onDestroyRegistrationCount++;
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx >= 0) {
        this.callbacks.splice(idx, 1);
      }
    };
  }

  markDestroyedWithoutCallbacks(): void {
    this.isDestroyedState = true;
  }

  triggerDestroy(): void {
    this.isDestroyedState = true;
    for (const cb of [...this.callbacks]) {
      cb();
    }
  }
}

class StubEnvironmentInjector extends EnvironmentInjector {
  readonly stubDestroyRef = new StubDestroyRef();
  private isDestroyedState = false;
  throwOnGetAfterInit: Error | null = null;
  private initialized = false;

  override get destroyed(): boolean {
    return this.isDestroyedState;
  }

  markInitialized(): void {
    this.initialized = true;
  }

  markDestroyedWithoutTeardown(): void {
    this.isDestroyedState = true;
    this.stubDestroyRef.markDestroyedWithoutCallbacks();
  }

  override get<T>(token: ProviderToken<T>): T {
    if (this.initialized && this.throwOnGetAfterInit) {
      throw this.throwOnGetAfterInit;
    }
    if (token === DestroyRef) {
      return this.stubDestroyRef as unknown as T;
    }
    throw new Error(`Unexpected token requested on StubEnvironmentInjector: ${String(token)}`);
  }

  override runInContext<ReturnT>(fn: () => ReturnT): ReturnT {
    return fn();
  }

  override destroy(): void {
    this.isDestroyedState = true;
    this.stubDestroyRef.triggerDestroy();
  }
}

describe('initializeAngularReactivity', () => {
  const stubsToDestroy: StubEnvironmentInjector[] = [];

  function createStubInjector(): StubEnvironmentInjector {
    const stub = new StubEnvironmentInjector();
    stubsToDestroy.push(stub);
    return stub;
  }

  afterEach(() => {
    for (const stub of stubsToDestroy.splice(0)) {
      if (!stub.destroyed) {
        stub.destroy();
      }
    }
    TestBed.resetTestingModule();
    setSignalImplementation(_PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION);
  });

  it('updates the active injector across TestBed resets even when an earlier injector never ran DestroyRef callbacks', () => {
    TestBed.configureTestingModule({});
    const firstRoot = TestBed.inject(EnvironmentInjector);
    const mockDestroyRef = new StubDestroyRef();
    const firstChild = createEnvironmentInjector(
      [{provide: DestroyRef, useValue: mockDestroyRef}],
      firstRoot,
    );
    initializeAngularReactivity(firstChild);
    firstChild.destroy();
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({});
    const freshInjector = TestBed.inject(EnvironmentInjector);
    initializeAngularReactivity(freshInjector);

    const count = signal(1);
    const observed: number[] = [];
    const dispose = effect(() => {
      observed.push(getValue(count));
    });

    TestBed.tick();
    expect(observed).toEqual([1]);

    setValue(count, 2);
    TestBed.tick();
    expect(observed).toEqual([1, 2]);

    dispose();
  });

  it('keeps Angular signals attached when an older overlapping injector destroys while a newer injector stays active', () => {
    TestBed.configureTestingModule({});
    const rootInjector = TestBed.inject(EnvironmentInjector);
    const injectorA = createEnvironmentInjector([], rootInjector);
    const injectorB = createEnvironmentInjector([], rootInjector);

    initializeAngularReactivity(injectorA);
    initializeAngularReactivity(injectorB);

    injectorA.destroy();

    const state = signal('alpha');
    assertAngularSignal<string>(state);

    const observed: string[] = [];
    const dispose = effect(() => {
      observed.push(getValue(state));
    });

    TestBed.tick();
    expect(observed).toEqual(['alpha']);

    setValue(state, 'beta');
    TestBed.tick();
    expect(observed).toEqual(['alpha', 'beta']);

    dispose();
    injectorB.destroy();

    const afterAllDestroyed = signal('fallback');
    expect(isAngularSignal(afterAllDestroyed)).toBeFalse();
  });

  it('keeps effects hosted on an earlier live root injector when a child injector initializes and later destroys', () => {
    TestBed.configureTestingModule({});
    const rootInjector = TestBed.inject(EnvironmentInjector);
    const childInjector = createEnvironmentInjector([], rootInjector);

    initializeAngularReactivity(rootInjector);
    initializeAngularReactivity(childInjector);

    const value = signal(10);
    const observed: number[] = [];
    const dispose = effect(() => {
      observed.push(getValue(value));
    });

    TestBed.tick();
    expect(observed).toEqual([10]);

    childInjector.destroy();

    setValue(value, 20);
    TestBed.tick();
    expect(observed).toEqual([10, 20]);

    dispose();
  });

  it('ignores already-destroyed injectors and delegates to the default signal backend when all injectors are destroyed', () => {
    const destroyedStub = createStubInjector();
    destroyedStub.destroy();

    initializeAngularReactivity(destroyedStub);
    expect(isAngularSignal(signal(0))).toBeFalse();

    const activeStub = createStubInjector();
    initializeAngularReactivity(activeStub);
    expect(isAngularSignal(signal(0))).toBeTrue();

    activeStub.markDestroyedWithoutTeardown();

    let ran = false;
    let cleanedUp = false;
    const dispose = effect(() => {
      ran = true;
      return () => {
        cleanedUp = true;
      };
    });

    expect(ran).toBeTrue();
    expect(cleanedUp).toBeFalse();
    expect(isAngularSignal(signal(0))).toBeFalse();

    expect(() => dispose()).not.toThrow();
    expect(cleanedUp).toBeTrue();
  });

  it('evicts injectors that throw code-based or message-only NG0205 during effect registration, retries a live fallback injector, and rethrows other errors', () => {
    const codeBrokenInjector = createStubInjector();
    initializeAngularReactivity(codeBrokenInjector);
    codeBrokenInjector.markInitialized();
    codeBrokenInjector.throwOnGetAfterInit = Object.assign(
      new Error('Injector has already been destroyed.'),
      {code: -205},
    );

    const messageBrokenInjector = createStubInjector();
    initializeAngularReactivity(messageBrokenInjector);
    messageBrokenInjector.markInitialized();
    messageBrokenInjector.throwOnGetAfterInit = new Error(
      'NG0205: Injector has already been destroyed.',
    );

    TestBed.configureTestingModule({});
    const fallbackInjector = TestBed.inject(EnvironmentInjector);
    initializeAngularReactivity(fallbackInjector);

    const state = signal('ok');
    const observed: string[] = [];
    const dispose = effect(() => {
      observed.push(getValue(state));
    });

    TestBed.tick();
    expect(observed).toEqual(['ok']);
    dispose();

    TestBed.resetTestingModule();

    const nonNg0205Injector = createStubInjector();
    initializeAngularReactivity(nonNg0205Injector);
    nonNg0205Injector.markInitialized();
    nonNg0205Injector.throwOnGetAfterInit = new Error('Unexpected provider failure');

    expect(() =>
      effect(() => {
        getValue(state);
      }),
    ).toThrowError('Unexpected provider failure');
  });

  it('re-attaches Angular signals when web_core was externally reset while a live injector remained tracked', () => {
    const lingeringStub = createStubInjector();
    initializeAngularReactivity(lingeringStub);
    expect(isAngularSignal(signal(0))).toBeTrue();

    setSignalImplementation(_PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION);
    expect(isAngularSignal(signal(0))).toBeFalse();

    const freshStub = createStubInjector();
    initializeAngularReactivity(freshStub);
    expect(isAngularSignal(signal(0))).toBeTrue();
  });

  it('registers DestroyRef.onDestroy at most once for repeated calls with the same injector', () => {
    const stub = createStubInjector();

    initializeAngularReactivity(stub);
    initializeAngularReactivity(stub);
    initializeAngularReactivity(stub);

    expect(stub.stubDestroyRef.onDestroyRegistrationCount).toBe(1);
    stub.destroy();
  });
});
