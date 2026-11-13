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

// @vitest-environment node

import {describe, it, expect, vi} from 'vitest';

describe('import without a DOM', () => {
  it('has no HTMLElement in this environment', () => {
    expect(typeof HTMLElement).toBe('undefined');
  });

  it.each([
    ['@a2ui/react', () => import('../../src/index')],
    ['@a2ui/react/v0_9', () => import('../../src/v0_9/index')],
    ['the host element module', () => import('../../src/catalog/react_host_element')],
  ])('loads %s', async (_name, load) => {
    vi.resetModules();
    await expect(load()).resolves.toBeDefined();
  });
});
