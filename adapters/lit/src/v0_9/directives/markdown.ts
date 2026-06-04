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

import {html, noChange} from 'lit';
import {Directive, DirectiveParameters, Part, directive} from 'lit/directive.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import {until} from 'lit/directives/until.js';
import * as Types from '@a2ui/web_core/types/types';

class MarkdownDirective extends Directive {
  private lastValue: string | null = null;
  private lastTagClassMap: string | null = null;

  update(_part: Part, [value, markdownRenderer, markdownOptions]: DirectiveParameters<this>) {
    const jsonTagClassMap = JSON.stringify(markdownOptions?.tagClassMap);
    if (this.lastValue === value && jsonTagClassMap === this.lastTagClassMap) {
      return noChange;
    }

    this.lastValue = value;
    this.lastTagClassMap = jsonTagClassMap;
    return this.render(value, markdownRenderer, markdownOptions);
  }

  private static defaultMarkdownWarningLogged = false;
  /**
   * Renders the markdown string to HTML using the injected markdown renderer,
   * if present. Otherwise, it returns the value wrapped in a span.
   */
  render(
    value: string,
    markdownRenderer?: Types.MarkdownRenderer,
    markdownOptions?: Types.MarkdownRendererOptions,
  ) {
    if (markdownRenderer) {
      const rendered = markdownRenderer(value, markdownOptions).then(value => {
        // `value` is a plain string, which we need to convert to a template
        // with the `unsafeHTML` directive.
        // It is the responsibility of the markdown renderer to sanitize the HTML.
        return unsafeHTML(value);
      });
      // The until directive lets us render a placeholder *until* the rendered
      // content resolves.
      return until(rendered, html`<span class="no-markdown-renderer">${value}</span>`);
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
