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
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src/v0_8'),
      '@a2ui/react/v0_9': path.resolve(process.cwd(), 'src/v0_9/index.ts'),
      '@a2ui/react/v0_8': path.resolve(process.cwd(), 'src/v0_8/index.ts'),
      '@a2ui/react/styles': path.resolve(process.cwd(), 'src/styles/index.ts'),
      '@a2ui/react': path.resolve(process.cwd(), 'src/index.ts'),
    },
  },
});
