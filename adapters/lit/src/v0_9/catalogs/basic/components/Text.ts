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

import {html, nothing, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {TextApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController, Context} from '@a2ui/lit/v0_9';
import * as Types from '@a2ui/web_core/types/types';

import {markdown} from '../../../directives/directives.js';

@customElement('a2ui-basic-text')
export class A2uiBasicTextElement extends BasicCatalogA2uiLitElement<typeof TextApi> {
  /**
   * The styles of the text component can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-text-color-text`: The color of the text. Defaults to `--a2ui-color-on-background`.
   * - `--a2ui-text-caption-color`: The color for caption text. Defaults to `light-dark(#666, #aaa)`.
   *
   * It also supports `--_a2ui-text-color` override from parent components (like Button).
   */
  static styles = css`
    :host {
      display: inline-block;
      color: var(--_a2ui-text-color, var(--a2ui-text-color-text, var(--a2ui-color-on-background)));
    }
    p,
    h1,
    h2,
    h3,
    h4,
    h5,
    h6,
    ol,
    ul,
    li,
    blockquote,
    pre {
      margin: var(--_a2ui-text-margin, 0);
    }
    h1,
    h2,
    h3,
    h4,
    h5 {
      font-family: var(--a2ui-font-family-title, inherit);
      line-height: var(--a2ui-line-height-headings, 1.2);
    }
    h1 {
      font-size: var(--a2ui-font-size-2xl);
    }
    h2 {
      font-size: var(--a2ui-font-size-xl);
    }
    h3 {
      font-size: var(--a2ui-font-size-l);
    }
    p,
    h4 {
      font-size: var(--a2ui-font-size-m);
    }
    h5 {
      font-size: var(--a2ui-font-size-s);
    }
    p,
    ol,
    ul,
    li,
    blockquote,
    .a2ui-caption {
      line-height: var(--a2ui-line-height-body, 1.5);
    }
    .a2ui-caption,
    .a2ui-caption > *,
    .a2ui-caption ::slotted(*) {
      font-size: var(--a2ui-font-size-xs);
      color: var(--a2ui-text-caption-color, light-dark(#666, #aaa));
    }
    a {
      color: var(--a2ui-text-a-color, inherit);
      font-weight: var(--a2ui-text-a-font-weight, inherit);
    }
  `;

  // Retrieve a MarkdownRenderer provided by the application.
  @consume({context: Context.markdown, subscribe: true})
  accessor markdownRenderer: Types.MarkdownRenderer | undefined;

  protected createController() {
    return new A2uiController(this, TextApi);
  }

  render() {
    const props = this.controller.props;
    if (!props) return nothing;

    // Use props.variant to convert props.text to markdown
    let markdownText = typeof props.text === 'string' ? props.text : String(props.text ?? '');
    switch (props.variant) {
      case 'h1':
        markdownText = `# ${markdownText}`;
        break;
      case 'h2':
        markdownText = `## ${markdownText}`;
        break;
      case 'h3':
        markdownText = `### ${markdownText}`;
        break;
      case 'h4':
        markdownText = `#### ${markdownText}`;
        break;
      case 'h5':
        markdownText = `##### ${markdownText}`;
        break;
      default:
        break; // body and caption.
    }

    const renderedMarkdown = markdown(markdownText, this.markdownRenderer);
    // There's not a good way to handle the caption variant in markdown, so we
    // tag it with a class so it can be tweaked via CSS.
    if (props.variant === 'caption') {
      return html`<span class="a2ui-caption">${renderedMarkdown}</span>`;
    }
    return html`${renderedMarkdown}`;
  }
}

export const A2uiText = {
  ...TextApi,
  tagName: 'a2ui-basic-text',
};
