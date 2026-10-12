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

import {SecurityContext, inject} from '@angular/core';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {MarkdownRendererService} from '../interfaces/markdown-renderer-service';

/**
 * A markdown renderer that only sanitizes the text as HTML with Angular's
 * built-in HTML sanitizer, this does not result in any useful markdown rendering.
 *
 * Agent text is untrusted, so it is sanitized before it is marked as trusted:
 * script elements and event handler attributes are removed, and unsafe URLs
 * such as `javascript:` are neutralized.
 */
export class SanitizerMarkdownRendererService implements MarkdownRendererService {
  private readonly sanitizer = inject(DomSanitizer);

  render(markdown: string): Promise<SafeHtml> {
    const html = this.sanitizer.sanitize(SecurityContext.HTML, markdown) ?? '';
    return Promise.resolve(this.sanitizer.bypassSecurityTrustHtml(html));
  }
}
