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

let globalMarkdownRenderer: MarkdownRenderer | undefined;

/**
 * Sets the global markdown renderer for basic catalog text components.
 * Host applications or renderer packages can register a renderer (e.g. from `@a2ui/markdown-it`)
 * to automatically render markdown without explicit per-component context configuration.
 */
export function setMarkdownRenderer(renderer?: MarkdownRenderer): void {
  globalMarkdownRenderer = renderer;
}

/**
 * Gets the currently registered global markdown renderer, if any.
 */
export function getMarkdownRenderer(): MarkdownRenderer | undefined {
  return globalMarkdownRenderer;
}

/** @internal For testing purposes only */
export function resetMarkdownWarningLoggedForTesting(): void {
  MarkdownDirective.resetWarningForTesting();
}

class MarkdownDirective extends AsyncDirective {
  private static defaultMarkdownWarningLogged = false;
  private lastValue: string | null = null;
  private lastRenderer: MarkdownRenderer | undefined = undefined;
  private lastTagClassMap: string | null = null;

  /** @internal For testing purposes only */
  static resetWarningForTesting(): void {
    MarkdownDirective.defaultMarkdownWarningLogged = false;
  }

  override update(
    _part: Part,
    [value, markdownRenderer, markdownOptions]: DirectiveParameters<this>,
  ) {
    const effectiveRenderer = markdownRenderer ?? globalMarkdownRenderer;
    const jsonTagClassMap = JSON.stringify(markdownOptions?.tagClassMap);
    if (
      this.lastValue === value &&
      this.lastRenderer === effectiveRenderer &&
      jsonTagClassMap === this.lastTagClassMap
    ) {
      return noChange;
    }

    this.lastValue = value;
    this.lastRenderer = effectiveRenderer;
    this.lastTagClassMap = jsonTagClassMap;
    return this.render(value, effectiveRenderer, markdownOptions);
  }

  render(
    value: string,
    markdownRenderer?: MarkdownRenderer,
    markdownOptions?: MarkdownRendererOptions,
  ) {
    const effectiveRenderer = markdownRenderer ?? globalMarkdownRenderer;
    const renderFn =
      typeof effectiveRenderer === 'function'
        ? effectiveRenderer
        : (effectiveRenderer as any)?.['render']?.bind(effectiveRenderer);

    if (renderFn) {
      Promise.resolve(renderFn(value, markdownOptions)).then((renderedStr: string) => {
        if (this.isConnected) {
          this.setValue(unsafeHTML(renderedStr));
        }
      });
      return html`<span class="no-markdown-renderer">${value}</span>`;
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
