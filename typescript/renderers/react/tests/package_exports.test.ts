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

import {describe, expect, it} from 'vitest';
import * as root from '../dist/index.js';
import * as v09 from '../dist/v0_9/index.js';
import * as v08 from '../dist/v0_8/index.js';

describe('React package exports', () => {
  it('re-exports runtime exports in v0_9 with identical identity', () => {
    const commonExports = [
      'A2uiSurface',
      'createBinderlessComponentImplementation',
      'createComponentImplementation',
      'MarkdownComponentContext',
      'MarkdownContext',
      'useMarkdownRenderer',
      'useSignalValue',
    ] as const;

    for (const name of commonExports) {
      expect(root).toHaveProperty(name);
      expect(v09).toHaveProperty(name);
      expect((root as Record<string, unknown>)[name]).toBe((v09 as Record<string, unknown>)[name]);
    }
  });

  it('isolates v0_8 from root runtime identity', () => {
    const runtimeExports = [
      'A2uiSurface',
      'createBinderlessComponentImplementation',
      'createComponentImplementation',
      'useNodeView',
      'useSignalValue',
    ];

    for (const name of runtimeExports) {
      expect(v08).not.toHaveProperty(name);
    }

    for (const key of Object.keys(v08)) {
      if (key in root) {
        expect((root as Record<string, unknown>)[key]).not.toBe(
          (v08 as Record<string, unknown>)[key],
        );
      }
    }
  });
});
