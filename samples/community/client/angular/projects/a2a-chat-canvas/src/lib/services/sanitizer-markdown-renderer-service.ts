/*
 * Copyright 2024 Google LLC
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

import {DefaultMarkdownRenderer, MarkdownRenderer} from '@a2ui/angular/v0_9';
import {isPlatformBrowser} from '@angular/common';
import {PLATFORM_ID, SecurityContext, inject} from '@angular/core';
import {DomSanitizer} from '@angular/platform-browser';

import type {MarkdownRendererService} from '../interfaces/markdown-renderer-service';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Default Markdown renderer that delegates to the `@a2ui/angular/v0_9`
 * {@link MarkdownRenderer} token (configured via `provideMarkdownRenderer` from
 * `@a2ui/angular/v0_9`, falling back to {@link DefaultMarkdownRenderer} and
 * `@a2ui/markdown-it` in browser environments) and sanitizes the rendered output
 * with Angular's {@link DomSanitizer}.
 *
 * Returns a plain sanitized HTML string instead of bypassing Angular's HTML
 * sanitizer, so Angular's `[innerHTML]` binding continues to enforce
 * `SecurityContext.HTML`. On server platforms without a custom renderer, or
 * when rendering fails or returns the input unchanged, raw text is HTML-escaped
 * before sanitization so untrusted markup is rendered as literal text.
 */
export class SanitizerMarkdownRendererService implements MarkdownRendererService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly customRenderer = inject(MarkdownRenderer, {optional: true});
  private readonly defaultRenderer = inject(DefaultMarkdownRenderer);

  async render(markdown: string): Promise<string> {
    const renderer =
      this.customRenderer ?? (isPlatformBrowser(this.platformId) ? this.defaultRenderer : null);
    let rendered: string;
    if (renderer) {
      try {
        rendered = await renderer.render(markdown);
        if (rendered === markdown) {
          // Treat unchanged pass-through output (for example, when
          // DefaultMarkdownRenderer cannot load @a2ui/markdown-it) as plain text.
          rendered = escapeHtml(markdown);
        }
      } catch {
        rendered = escapeHtml(markdown);
      }
    } else {
      rendered = escapeHtml(markdown);
    }
    return this.sanitizer.sanitize(SecurityContext.HTML, rendered) ?? '';
  }
}
