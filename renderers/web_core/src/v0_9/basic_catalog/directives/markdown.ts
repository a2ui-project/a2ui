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
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import type {MarkdownRenderer, MarkdownRendererOptions} from '../context/markdown.js';

class MarkdownDirective extends AsyncDirective {
  private lastValue: string | null = null;
  private lastRenderer: MarkdownRenderer | undefined = undefined;
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

  private static defaultMarkdownWarningLogged = false;

  render(
    value: string,
    markdownRenderer?: MarkdownRenderer,
    markdownOptions?: MarkdownRendererOptions,
  ) {
    if (markdownRenderer) {
      const renderFn =
        typeof markdownRenderer === 'function'
          ? markdownRenderer
          : (markdownRenderer as any)?.['render']?.bind(markdownRenderer);
      if (renderFn) {
        Promise.resolve(renderFn(value, markdownOptions)).then((renderedStr: string) => {
          if (this.isConnected) {
            this.setValue(unsafeHTML(renderedStr));
          }
        });
        return html`<span class="no-markdown-renderer">${value}</span>`;
      }
    }

    if (!MarkdownDirective.defaultMarkdownWarningLogged) {
      console.warn(
        '[MarkdownDirective]',
        "can't render markdown because no markdown renderer is configured.\n",
        'Use `@a2ui/markdown-it`, or your own markdown renderer.',
      );
      MarkdownDirective.defaultMarkdownWarningLogged = true;
    }
    return html`<span class="no-markdown-renderer">${value}</span>`;
  }
}

export const markdown = directive(MarkdownDirective);
