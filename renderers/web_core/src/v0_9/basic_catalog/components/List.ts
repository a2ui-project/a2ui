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
import {repeat} from 'lit/directives/repeat.js';
import {ListApi} from './basic_components.js';
import {
  BasicCatalogA2uiLitElement,
  type ResolvedChildList,
} from '../basic-catalog-a2ui-lit-element.js';
import {WebComponentImplementation} from '../../catalog/types.js';

function getChildKey(child: any): string {
  return typeof child === 'object' && child !== null
    ? `${child.basePath ?? ''}/${child.id}`
    : String(child);
}

@customElement('a2ui-list')
export class A2uiListElement extends BasicCatalogA2uiLitElement<typeof ListApi> {
  static override styles = css`
    .a2ui-list {
      display: flex;
      padding-inline-start: var(--a2ui-list-padding, var(--a2ui-spacing-l, 24px));
      margin: 0;
    }
    .a2ui-list.vertical {
      flex-direction: column;
      gap: var(--a2ui-list-gap, var(--a2ui-spacing-s, 8px));
    }
    .a2ui-list.horizontal {
      flex-direction: row;
      gap: var(--a2ui-list-gap, var(--a2ui-spacing-m, 16px));
      list-style-position: inside;
    }
    .a2ui-list-item-none {
      display: block;
    }
    .horizontal .a2ui-list-item-none {
      display: inline-block;
    }
  `;

  protected readonly api = ListApi;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const children: ResolvedChildList = Array.isArray(props.children) ? props.children : [];
    const listStyle = props.listStyle;
    const direction = props.direction || 'vertical';

    if (listStyle === 'ordered') {
      return html`
        <ol class="a2ui-list ${direction}">
          ${repeat(children, getChildKey, child => html`<li>${this.renderNode(child)}</li>`)}
        </ol>
      `;
    }

    if (listStyle === 'unordered') {
      return html`
        <ul class="a2ui-list ${direction}">
          ${repeat(children, getChildKey, child => html`<li>${this.renderNode(child)}</li>`)}
        </ul>
      `;
    }

    return html`
      <div class="a2ui-list ${direction}">
        ${repeat(
          children,
          getChildKey,
          child => html`<div class="a2ui-list-item-none">${this.renderNode(child)}</div>`,
        )}
      </div>
    `;
  }
}

export const A2uiList: WebComponentImplementation = {
  ...ListApi,
  tagName: 'a2ui-list',
};
