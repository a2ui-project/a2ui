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

import {html, noChange} from 'lit';
import {directive, DirectiveParameters, Part} from 'lit/directive.js';
import {AsyncDirective} from 'lit/async-directive.js';
import * as Types from '../../../v0_8/types/types.js';

let defaultMarkdownRendererPromise:
  | Promise<((text: string, options?: Types.MarkdownRendererOptions) => Promise<string>) | null>
  | undefined;

async function getDefaultMarkdownRenderer(): Promise<
  ((text: string, options?: Types.MarkdownRendererOptions) => Promise<string>) | null
> {
  if (!defaultMarkdownRendererPromise) {
    defaultMarkdownRendererPromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - optional peer dependency
        const mod = await import('@a2ui/markdown-it');
        return (
          mod.renderMarkdown || (mod as any).default?.renderMarkdown || (mod as any).default || null
        );
      } catch (err) {
        console.warn(
          '[MarkdownDirective] Failed to load optional `@a2ui/markdown-it` renderer:',
          err,
        );
        return null;
      }
    })();
  }
  return defaultMarkdownRendererPromise;
}

class MarkdownDirective extends AsyncDirective {
  private lastValue: string | null = null;
  private lastRenderer: Types.MarkdownRenderer | undefined = undefined;
  private lastTagClassMap: string | null = null;

  override update(
    _part: Part,
    [value, markdownRenderer, markdownOptions]: DirectiveParameters<this>,
  ) {
    const jsonTagClassMap = JSON.stringify(markdownOptions?.tagClassMap);
    if (
      this.lastValue === value &&
      this.lastRenderer === markdownRenderer &&
      jsonTagClassMap === this.lastTagClassMap
    ) {
      return noChange;
    }

    this.lastValue = value;
    this.lastRenderer = markdownRenderer;
    this.lastTagClassMap = jsonTagClassMap;
    return this.render(value, markdownRenderer, markdownOptions);
  }

  render(
    value: string,
    markdownRenderer?: Types.MarkdownRenderer,
    markdownOptions?: Types.MarkdownRendererOptions,
  ) {
    const renderFn =
      typeof markdownRenderer === 'function'
        ? markdownRenderer
        : (markdownRenderer as any)?.['render']?.bind(markdownRenderer);

    if (renderFn) {
      Promise.resolve(renderFn(value, markdownOptions)).then((renderedStr: string) => {
        if (value !== this.lastValue) return;
        if (this.isConnected && typeof document !== 'undefined') {
          const fragment = document.createRange().createContextualFragment(renderedStr);
          this.setValue(fragment);
        }
      });
      return html`<span class="no-markdown-renderer">${value}</span>`;
    }

    getDefaultMarkdownRenderer().then(defaultRenderer => {
      if (value !== this.lastValue || !this.isConnected) return;
      if (defaultRenderer) {
        defaultRenderer(value, markdownOptions).then((renderedStr: string) => {
          if (value !== this.lastValue) return;
          if (this.isConnected && typeof document !== 'undefined') {
            const fragment = document.createRange().createContextualFragment(renderedStr);
            this.setValue(fragment);
          }
        });
      }
    });

    return html`<span class="no-markdown-renderer">${value}</span>`;
  }
}

export const markdown = directive(MarkdownDirective);
