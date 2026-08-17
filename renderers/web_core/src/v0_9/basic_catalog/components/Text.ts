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

import {html, nothing, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {TextApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {Context} from '../context/context.js';
import type {MarkdownRenderer} from '../context/markdown.js';
import {markdown} from '../directives/directives.js';
import {createComponentImplementation} from '../../catalog/types.js';

const NON_MARKDOWN_VARIANTS = new Set<string>(['h1', 'h2', 'h3', 'h4', 'h5', 'caption']);

@customElement('a2ui-basic-text')
export class A2uiBasicTextElement extends BasicCatalogA2uiLitElement<typeof TextApi> {
  /**
   * The styles of the text component can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-text-color-text`: The color of the text. Defaults to `--a2ui-color-on-background`.
   * - `--a2ui-text-caption-color`: The color for caption text. Defaults to `light-dark(#666, #aaa)`.
   */
  static override styles = css`
    :host {
      display: contents;
    }
    .a2ui-text p,
    .a2ui-text h1,
    .a2ui-text h2,
    .a2ui-text h3,
    .a2ui-text h4,
    .a2ui-text h5,
    .a2ui-text h6,
    .a2ui-text ol,
    .a2ui-text ul,
    .a2ui-text li,
    .a2ui-text blockquote,
    .a2ui-text pre {
      margin: var(--_a2ui-text-margin, 0);
    }
    .a2ui-text {
      color: var(--_a2ui-text-color, var(--a2ui-text-color-text, var(--a2ui-color-on-background)));
    }
    .a2ui-text h1,
    .a2ui-text h2,
    .a2ui-text h3,
    .a2ui-text h4,
    .a2ui-text h5,
    .a2ui-text h6 {
      font-family: var(--a2ui-font-family-title, inherit);
      line-height: var(--a2ui-line-height-headings, 1.2);
    }
    .a2ui-text h1 {
      font-size: var(--a2ui-font-size-2xl);
    }
    .a2ui-text h2 {
      font-size: var(--a2ui-font-size-xl);
    }
    .a2ui-text h3 {
      font-size: var(--a2ui-font-size-l);
    }
    .a2ui-text p,
    .a2ui-text h4 {
      font-size: var(--a2ui-font-size-m);
    }
    .a2ui-text h5 {
      font-size: var(--a2ui-font-size-s);
    }
    .a2ui-text p {
      line-height: var(--a2ui-line-height-body, 1.5);
    }
    .a2ui-text.caption,
    .a2ui-caption {
      font-size: var(--a2ui-font-size-xs);
      color: var(--a2ui-text-caption-color, light-dark(#666, #aaa));
    }
    .a2ui-text a {
      color: var(--a2ui-text-a-color, inherit);
      font-weight: var(--a2ui-text-a-font-weight, inherit);
    }
  `;

  @consume({context: Context.markdown, subscribe: true})
  markdownRenderer: MarkdownRenderer | undefined;

  protected readonly api = TextApi;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const variant = props.variant || 'body';
    const text = typeof props.text === 'string' ? props.text : String(props.text ?? '');

    const flexStyle = typeof props.weight === 'number' ? `flex: ${props.weight};` : nothing;

    if (NON_MARKDOWN_VARIANTS.has(variant)) {
      let content = html`${text}`;
      switch (variant) {
        case 'h1':
          content = html`<h1>${text}</h1>`;
          break;
        case 'h2':
          content = html`<h2>${text}</h2>`;
          break;
        case 'h3':
          content = html`<h3>${text}</h3>`;
          break;
        case 'h4':
          content = html`<h4>${text}</h4>`;
          break;
        case 'h5':
          content = html`<h5>${text}</h5>`;
          break;
        case 'caption':
          content = html`<em>${text}</em>`;
          break;
      }
      return html`<span class="a2ui-text ${variant}" style=${flexStyle}>${content}</span>`;
    }

    const renderedMarkdown = markdown(text, this.markdownRenderer);
    return html`<span class="a2ui-text ${variant}" style=${flexStyle}>${renderedMarkdown}</span>`;
  }
}

export const A2uiText = createComponentImplementation(TextApi, A2uiBasicTextElement);
