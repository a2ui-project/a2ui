/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import DOMPurify from 'dompurify';

// An isomorphic instance of DOMPurify.
// We use this instead of `isomorphic-dompurify` because our angular samples
// don't like building with jsdom as a "dependency" (not dev). Since this
// package is meant to be used by all renderers, we add some code in the
// sanitize function to initialize this the first time, looking at the
// environment (globalThis).
let purify: any;

/**
 * Sanitizes an HTML string.
 * @param {string} html the HTML string to sanitize.
 * @returns a sanitized HTML string.
 */
export function sanitize(html: string): string {
  if (!purify) {
    if (typeof DOMPurify.sanitize === 'function') {
      purify = DOMPurify;
    } else {
      const globalWindow = (globalThis as any).window;
      if (globalWindow) {
        purify = DOMPurify(globalWindow);
      } else {
        throw new Error(
          'DOMPurify requires a window object. If testing, provide a jsdom window as `globalThis`.',
        );
      }
    }
  }
  return purify.sanitize(html);
}
