/*
 * Copyright 2026 Google LLC
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

import {useCallback, useState} from 'react';

const STORAGE_KEY = 'margin.showInternals';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** The header's "Show internals" switch: off by default, remembered in `localStorage`. */
export function useShowInternals(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(readStored);
  const update = useCallback((next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Storage can be unavailable (private mode); the switch still works for this page.
    }
  }, []);
  return [value, update];
}
