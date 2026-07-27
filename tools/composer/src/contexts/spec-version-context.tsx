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

/**
 * Global A2UI spec version context.
 *
 * Controls which version (v0.8 or v0.9) the entire composer uses for
 * rendering, gallery samples, component docs, and new widget creation.
 * Persisted to localStorage.
 *
 * Uses useEffect to load from localStorage after hydration to avoid
 * server/client mismatch. The `isLoaded` flag lets consumers defer
 * version-dependent rendering until the client value is available.
 */
'use client';

import {createContext, useContext, useState, useEffect, useCallback, type ReactNode} from 'react';
import type {SpecVersion} from '@/types/widget';

const STORAGE_KEY = 'a2ui-spec-version';
const DEFAULT_VERSION: SpecVersion = '0.9';

interface SpecVersionContextValue {
  specVersion: SpecVersion;
  setSpecVersion: (version: SpecVersion) => void;
  isLoaded: boolean;
}

const SpecVersionContext = createContext<SpecVersionContextValue | null>(null);

export function SpecVersionProvider({children}: {children: ReactNode}) {
  const [specVersion, setSpecVersionState] = useState<SpecVersion>(DEFAULT_VERSION);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage after hydration
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === '0.8' || stored === '0.9') {
      setSpecVersionState(stored);
    }
    setIsLoaded(true);
  }, []);

  const setSpecVersion = useCallback((version: SpecVersion) => {
    setSpecVersionState(version);
    localStorage.setItem(STORAGE_KEY, version);
  }, []);

  return (
    <SpecVersionContext.Provider value={{specVersion, setSpecVersion, isLoaded}}>
      {children}
    </SpecVersionContext.Provider>
  );
}

export function useSpecVersion() {
  const context = useContext(SpecVersionContext);
  if (!context) {
    throw new Error('useSpecVersion must be used within a SpecVersionProvider');
  }
  return context;
}
