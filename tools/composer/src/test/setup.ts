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

import '@testing-library/jest-dom';
import {vi} from 'vitest';

// Mock matchMedia if needed (common for some Radix/UI components)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver;

// Neutralize programmatic anchor clicks (e.g. file-download handlers that do
// `a.href = url; a.click()`). In jsdom these attempt a real navigation, which
// logs "Not implemented: navigation to another Document" and leaves the run
// hanging so `vitest run` never exits. React Testing Library dispatches events
// via dispatchEvent (not Element.click), and button clicks go through
// HTMLElement.prototype.click, so overriding only the anchor prototype is safe.
HTMLAnchorElement.prototype.click = vi.fn();
