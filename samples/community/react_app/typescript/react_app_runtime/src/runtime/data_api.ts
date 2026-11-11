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

/**
 * The data, function and action API of the `a2ui` module. The signatures and their documentation
 * for the model live in `a2ui.d.ts`; this file implements them on the runtime session.
 */

import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {getSession, toErrorDetails} from './session.js';

/** A value that survives JSON serialization. */
export type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};

/** `T` when every value it can hold is JSON; `useData` and `setData` require it. */
export type JsonCompatible<T> = {
  [K in keyof T]: [T[K]] extends [JsonValue]
    ? T[K]
    : T[K] extends (...args: never[]) => unknown
      ? never
      : JsonCompatible<T[K]>;
} & ([T] extends [(...args: never[]) => unknown] ? never : unknown);

/** Default timeout of `callFunction`, matching the agent function timeout of web_core. */
export const DEFAULT_FUNCTION_TIMEOUT_MS = 30_000;

/** Options of {@link callFunction}. */
export interface CallFunctionOptions {
  timeoutMs?: number;
}

/** State of a call made by {@link useFunction}. */
export interface FunctionState<R> {
  data: R | undefined;
  loading: boolean;
  error: Error | undefined;
  refresh: () => void;
}

export function useData<T extends JsonCompatible<T>>(
  path: string,
  fallback: T,
): [T, (value: T | ((previous: T) => T)) => void] {
  const {store} = getSession();
  const subscribeToPath = useCallback(
    (listener: () => void) => store.watch(path, listener),
    [store, path],
  );
  const value = useSyncExternalStore(subscribeToPath, () => store.get(path));
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const setter = useCallback(
    (next: T | ((previous: T) => T)) => {
      const previous = store.has(path) ? (store.get(path) as T) : fallbackRef.current;
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
      store.write(path, resolved).catch(() => {
        // Reported to the host as a bridge error by the session.
      });
    },
    [store, path],
  );
  return [value === undefined ? fallback : (value as T), setter];
}

export async function getData<T = JsonValue>(path: string): Promise<T | undefined> {
  return (await getSession().store.read(path)) as T | undefined;
}

export function setData<T extends JsonCompatible<T>>(path: string, value: T): Promise<void> {
  return getSession().store.write(path, value);
}

export function subscribe<T = JsonValue>(
  path: string,
  onChange: (value: T | undefined) => void,
): () => void {
  const {store} = getSession();
  let last: unknown = Symbol('unset');
  const notify = () => {
    const value = store.get(path);
    if (value !== last) {
      last = value;
      onChange(value as T | undefined);
    }
  };
  const stop = store.watch(path, notify);
  if (store.has(path)) {
    notify();
  }
  return stop;
}

export async function callFunction<R = JsonValue>(
  name: string,
  args: {[key: string]: JsonValue} = {},
  options: CallFunctionOptions = {},
): Promise<R> {
  const session = getSession();
  try {
    const result = await session.client.request<{value?: unknown}>(
      'function/call',
      {name, args},
      options.timeoutMs ?? DEFAULT_FUNCTION_TIMEOUT_MS,
    );
    return result.value as R;
  } catch (error) {
    session.reportError('bridge', toErrorDetails(error, `Function ${name} failed`));
    throw error;
  }
}

export function useFunction<R = JsonValue>(
  name: string,
  args: {[key: string]: JsonValue} | null,
  options: CallFunctionOptions = {},
): FunctionState<R> {
  const key = args === null ? null : JSON.stringify(args);
  const [state, setState] = useState<{data: R | undefined; loading: boolean; error?: Error}>({
    data: undefined,
    loading: key !== null,
  });
  const [refreshCount, setRefreshCount] = useState(0);
  const latestCall = useRef(0);
  const timeoutMs = options.timeoutMs;

  useEffect(() => {
    if (key === null) {
      latestCall.current++;
      setState(previous => ({data: previous.data, loading: false}));
      return;
    }
    const call = ++latestCall.current;
    setState(previous => ({data: previous.data, loading: true}));
    callFunction<R>(name, JSON.parse(key) as {[key: string]: JsonValue}, {timeoutMs}).then(
      data => {
        if (call === latestCall.current) {
          setState({data, loading: false});
        }
      },
      (error: unknown) => {
        if (call === latestCall.current) {
          setState(previous => ({
            data: previous.data,
            loading: false,
            error: error instanceof Error ? error : new Error(String(error)),
          }));
        }
      },
    );
  }, [name, key, timeoutMs, refreshCount]);

  const refresh = useCallback(() => setRefreshCount(count => count + 1), []);
  return {data: state.data, loading: state.loading, error: state.error, refresh};
}

export async function dispatchAction(
  name: string,
  context: {[key: string]: JsonValue} = {},
): Promise<void> {
  const session = getSession();
  try {
    await session.client.request('action/dispatch', {name, context});
  } catch (error) {
    session.reportError('bridge', toErrorDetails(error, `Action ${name} failed`));
    throw error;
  }
}
