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

import React, {useState} from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {
  useSyncExternalStore,
  useSyncExternalStoreClient,
  useSyncExternalStoreServer,
} from '../src/use_sync_external_store';

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    setState: (next: T) => {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
    notifyWithoutChange: () => {
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount: () => listeners.size,
  };
}

describe('useSyncExternalStore compatibility', () => {
  it('reads initial snapshot and re-renders on store updates via useSyncExternalStoreClient', () => {
    const store = createStore('initial');
    let renderCount = 0;

    function Reader() {
      renderCount++;
      const value = useSyncExternalStoreClient(store.subscribe, store.getSnapshot);
      return <div data-testid="value">{value}</div>;
    }

    const {unmount} = render(<Reader />);
    expect(screen.getByTestId('value')).toHaveTextContent('initial');
    expect(store.listenerCount()).toBe(1);

    const rendersAfterMount = renderCount;

    // Notifying without changing the snapshot should not trigger a re-render.
    act(() => {
      store.notifyWithoutChange();
    });
    expect(renderCount).toBe(rendersAfterMount);

    act(() => {
      store.setState('updated');
    });
    expect(screen.getByTestId('value')).toHaveTextContent('updated');
    expect(renderCount).toBeGreaterThan(rendersAfterMount);

    unmount();
    expect(store.listenerCount()).toBe(0);
  });

  it('handles synchronous updates triggered inside subscribe on mount', () => {
    let snapshot: string | undefined;

    const subscribe = (onChange: () => void) => {
      snapshot = 'ready-from-subscribe';
      onChange();
      return () => {
        snapshot = undefined;
      };
    };
    const getSnapshot = () => snapshot;

    function Reader() {
      const value = useSyncExternalStoreClient(subscribe, getSnapshot);
      return <div data-testid="value">{value ?? 'pending'}</div>;
    }

    render(<Reader />);
    expect(screen.getByTestId('value')).toHaveTextContent('ready-from-subscribe');
  });

  it('detects snapshot mutations between render and effect subscription', () => {
    const store = createStore(1);
    let mutatedDuringRender = false;

    function Reader() {
      const value = useSyncExternalStoreClient(store.subscribe, store.getSnapshot);
      if (!mutatedDuringRender) {
        mutatedDuringRender = true;
        // Mutate before passive subscription effect has attached.
        store.setState(2);
      }
      return <div data-testid="value">{value}</div>;
    }

    render(<Reader />);
    expect(screen.getByTestId('value')).toHaveTextContent('2');
  });

  it('re-subscribes when subscribe identity changes', () => {
    const storeA = createStore('A');
    const storeB = createStore('B');

    function Switcher() {
      const [useB, setUseB] = useState(false);
      const active = useB ? storeB : storeA;
      const value = useSyncExternalStoreClient(active.subscribe, active.getSnapshot);
      return (
        <div>
          <span data-testid="value">{value}</span>
          <button type="button" onClick={() => setUseB(true)}>
            Switch
          </button>
        </div>
      );
    }

    render(<Switcher />);
    expect(screen.getByTestId('value')).toHaveTextContent('A');
    expect(storeA.listenerCount()).toBe(1);
    expect(storeB.listenerCount()).toBe(0);

    fireEvent.click(screen.getByRole('button', {name: 'Switch'}));
    expect(screen.getByTestId('value')).toHaveTextContent('B');
    expect(storeA.listenerCount()).toBe(0);
    expect(storeB.listenerCount()).toBe(1);
  });

  it('uses getServerSnapshot when provided in useSyncExternalStoreServer without subscribing', () => {
    const subscribe = vi.fn(() => () => {});
    const getSnapshot = vi.fn(() => 'client');
    const getServerSnapshot = vi.fn(() => 'server');

    expect(useSyncExternalStoreServer(subscribe, getSnapshot, getServerSnapshot)).toBe('server');
    expect(subscribe).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(getServerSnapshot).toHaveBeenCalledTimes(1);

    expect(useSyncExternalStoreServer(subscribe, getSnapshot)).toBe('client');
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('exports working default useSyncExternalStore for the active React runtime', () => {
    const store = createStore(10);

    function Reader() {
      const value = useSyncExternalStore(store.subscribe, store.getSnapshot);
      return <div data-testid="value">{value}</div>;
    }

    render(<Reader />);
    expect(screen.getByTestId('value')).toHaveTextContent('10');

    act(() => {
      store.setState(42);
    });
    expect(screen.getByTestId('value')).toHaveTextContent('42');
  });
});
