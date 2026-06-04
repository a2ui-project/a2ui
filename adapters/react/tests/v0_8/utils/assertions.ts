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

import type {Mock} from 'vitest';

/**
 * Safely get a mock call argument with proper typing.
 * Throws if the call doesn't exist (test failure).
 */
export function getMockCallArg<T>(mock: Mock, callIndex: number, argIndex = 0): T {
  const calls = mock.mock.calls;
  const call = calls[callIndex];
  if (!call) {
    throw new Error(`Mock call at index ${callIndex} does not exist. Total calls: ${calls.length}`);
  }
  return call[argIndex] as T;
}

/**
 * Get an element from an array with bounds checking.
 * Throws if index is out of bounds (test failure).
 */
export function getElement<T>(array: T[], index: number): T {
  const element = array[index];
  if (element === undefined) {
    throw new Error(
      `Array element at index ${index} does not exist. Array length: ${array.length}`,
    );
  }
  return element;
}
