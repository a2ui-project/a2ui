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

import React, {useDebugValue, useEffect, useLayoutEffect, useRef, useState} from 'react';

type Subscribe = (onStoreChange: () => void) => () => void;

type UseSyncExternalStore = <Snapshot>(
  subscribe: Subscribe,
  getSnapshot: () => Snapshot,
  getServerSnapshot?: () => Snapshot,
) => Snapshot;

interface StoreInstance<Snapshot> {
  value: Snapshot;
  getSnapshot: () => Snapshot;
}

function checkIfSnapshotChanged<Snapshot>(inst: StoreInstance<Snapshot>): boolean {
  const latestGetSnapshot = inst.getSnapshot;
  const prevValue = inst.value;
  try {
    const nextValue = latestGetSnapshot();
    return !Object.is(prevValue, nextValue);
  } catch {
    return true;
  }
}

export function useSyncExternalStoreClient<Snapshot>(
  subscribe: Subscribe,
  getSnapshot: () => Snapshot,
): Snapshot {
  const value = getSnapshot();
  const [, forceUpdate] = useState({});
  const instRef = useRef<StoreInstance<Snapshot>>({value, getSnapshot});

  useLayoutEffect(() => {
    instRef.current.value = value;
    instRef.current.getSnapshot = getSnapshot;
    if (checkIfSnapshotChanged(instRef.current)) {
      forceUpdate({});
    }
  }, [subscribe, value, getSnapshot]);

  useEffect(() => {
    if (checkIfSnapshotChanged(instRef.current)) {
      forceUpdate({});
    }
    return subscribe(() => {
      if (checkIfSnapshotChanged(instRef.current)) {
        forceUpdate({});
      }
    });
  }, [subscribe]);

  useDebugValue(value);
  return value;
}

export function useSyncExternalStoreServer<Snapshot>(
  _subscribe: Subscribe,
  getSnapshot: () => Snapshot,
  getServerSnapshot?: () => Snapshot,
): Snapshot {
  return getServerSnapshot ? getServerSnapshot() : getSnapshot();
}

const isServerEnvironment =
  typeof window === 'undefined' ||
  typeof window.document === 'undefined' ||
  typeof window.document.createElement === 'undefined';

export const useSyncExternalStoreCompat: UseSyncExternalStore = isServerEnvironment
  ? useSyncExternalStoreServer
  : useSyncExternalStoreClient;

// Looked up dynamically so type-checking succeeds against @types/react@17 as
// well as @types/react@18+.
const nativeUseSyncExternalStore = (
  React as unknown as {useSyncExternalStore?: UseSyncExternalStore}
).useSyncExternalStore;

export const useSyncExternalStore: UseSyncExternalStore =
  nativeUseSyncExternalStore ?? useSyncExternalStoreCompat;
