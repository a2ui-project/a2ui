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

import {html, nothing, css, PropertyValues} from 'lit';
import {customElement} from 'lit/decorators.js';
import {map} from 'lit/directives/map.js';
import {ListApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  BasicCatalogA2uiLitElement,
  type ResolvedChildList,
} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../../../a2ui-controller.js';

@customElement('a2ui-list')
export class A2uiListElement extends BasicCatalogA2uiLitElement<typeof ListApi> {
  static override styles = css`
    :host {
      display: flex;
      overflow: auto;
      gap: var(--a2ui-list-gap, var(--a2ui-spacing-m, 0.5rem));
      padding: var(--a2ui-list-padding, 0);
    }
  `;

  protected createController() {
    return new A2uiController(this, ListApi);
  }

  override updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    const props = this.controller.props;
    if (props) {
      this.style.flexDirection = props.direction === 'horizontal' ? 'row' : 'column';
    }
  }

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const children: ResolvedChildList = Array.isArray(props.children) ? props.children : [];
    return html`${map(children, child => html`${this.renderNode(child)}`)}`;
  }
}

export const A2uiList = {
  ...ListApi,
  tagName: 'a2ui-list',
};
