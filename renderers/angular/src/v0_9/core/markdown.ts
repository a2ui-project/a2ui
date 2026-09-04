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

import {Injectable} from '@angular/core';
import type {
  MarkdownRenderer as MarkdownRendererFn,
  MarkdownRendererOptions,
} from '@a2ui/web_core/v0_8';

export type {MarkdownRendererOptions};

export abstract class MarkdownRenderer {
  abstract render(markdown: string, options?: MarkdownRendererOptions): Promise<string>;
}

@Injectable({
  providedIn: 'root',
})
export class DefaultMarkdownRenderer extends MarkdownRenderer {
  private static warningLogged = false;

  override async render(markdown: string, _options?: MarkdownRendererOptions): Promise<string> {
    if (!DefaultMarkdownRenderer.warningLogged) {
      console.warn(
        '[DefaultMarkdownRenderer] No MarkdownRenderer configured. Plain text fallback used. ' +
          'Provide a renderer via `provideMarkdownRenderer(...)` with `@a2ui/markdown-it` if markdown formatting is required.',
      );
      DefaultMarkdownRenderer.warningLogged = true;
    }
    return markdown;
  }
}

export function provideMarkdownRenderer(renderFn?: MarkdownRendererFn) {
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
