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

import {Injectable} from '@angular/core';
import type {MarkdownRenderer as MarkdownRendererType, MarkdownRendererOptions} from '../types';

@Injectable({
  providedIn: 'root',
})
export abstract class MarkdownRenderer {
  abstract render(markdown: string, options?: MarkdownRendererOptions): Promise<string>;
}

@Injectable({
  providedIn: 'root',
})
export class DefaultMarkdownRenderer extends MarkdownRenderer {
  private static warningLogged = false;

  override async render(markdown: string, options?: MarkdownRendererOptions): Promise<string> {
    try {
      // @ts-ignore - optional peer dependency
      const {renderMarkdown} = await import('@a2ui/markdown-it');
      return await renderMarkdown(markdown, options);
    } catch (e) {
      if (!DefaultMarkdownRenderer.warningLogged) {
        console.warn(
          '[DefaultMarkdownRenderer] Failed to load optional `@a2ui/markdown-it` renderer. Using fallback regex.',
        );
        DefaultMarkdownRenderer.warningLogged = true;
      }
      // Basic implementation for v0.8
      return markdown;
    }
  }
}

export function provideMarkdownRenderer(renderFn?: MarkdownRendererType) {
  if (renderFn) {
    return {
      provide: MarkdownRenderer,
      useValue: {
        render: renderFn,
      },
    };
  }
  return {provide: MarkdownRenderer, useClass: DefaultMarkdownRenderer};
}
