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

import {afterEach} from 'vitest';

if (typeof window !== 'undefined') {
  /**
   * Polyfill for JSDOM lacking Constructed Stylesheets API support.
   * Lit utilizes adoptedStyleSheets to share stylesheet rules across shadow roots.
   */
  if (!document.adoptedStyleSheets) {
    (document as any).adoptedStyleSheets = [];
  }

  /**
   * Polyfill for CSSStyleSheet.prototype.replaceSync which is used by Lit
   * to load static component styles. Since JSDOM has no style parser or layout engine,
   * we intercept the CSS rules and insert them dynamically via standard HTML <style> tags.
   */
  if (window.CSSStyleSheet && !window.CSSStyleSheet.prototype.replaceSync) {
    window.CSSStyleSheet.prototype.replaceSync = function (text: string) {
      let styleEl = (this as any)._styleEl;
      if (!styleEl) {
        styleEl = document.createElement('style');
        document.head.appendChild(styleEl);
        (this as any)._styleEl = styleEl;
      }
      styleEl.textContent = text;
    };
  }
}

afterEach(() => {
  document.body.innerHTML = '';
});
