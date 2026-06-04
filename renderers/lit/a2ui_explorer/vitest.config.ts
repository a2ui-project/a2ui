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

import {defineConfig} from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup-tests.ts'],
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Map @a2ui/lit packages directly to their TypeScript source files.
      // This allows tests to run against live code changes without requiring a rebuild step first.
      '@a2ui/lit/v0_9': path.resolve(process.cwd(), '../src/v0_9/index.ts'),
      '@a2ui/lit': path.resolve(process.cwd(), '../src/index.ts'),
    },
    // Prevent "Multiple versions of Lit loaded" runtime errors. Dedupe resolves
    // lit imports to a single module instance, ensuring reactive cycles and
    // custom element registrations do not conflict.
    dedupe: ['lit'],
  },
});
