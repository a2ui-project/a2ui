// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {test, expect} from 'vitest';

/**
 * Smoke test to ensure that the Vite dev server compilation pipeline correctly
 * transpiles Lit decorators. In Vite 8, a target compilation bug can cause
 * esbuild to serve uncompiled Stage-3 class decorators raw to the browser,
 * resulting in runtime SyntaxErrors.
 *
 * For more details, see: https://github.com/a2ui-project/a2ui/issues/1645
 */
test('local-gallery compiles and registers without syntax errors', async () => {
  const mod = await import('../src/local-gallery.js');
  expect(mod.LocalGallery).toBeDefined();
  expect(customElements.get('local-gallery')).toBeDefined();
});
