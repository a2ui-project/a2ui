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
import {RowApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  BasicCatalogA2uiLitElement,
  type ResolvedChildList,
} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../../../a2ui-controller.js';

const JUSTIFY_MAP: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  spaceBetween: 'space-between',
  spaceAround: 'space-around',
  spaceEvenly: 'space-evenly',
  stretch: 'stretch',
};

const ALIGN_MAP: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

@customElement('a2ui-basic-row')
export class A2uiBasicRowElement extends BasicCatalogA2uiLitElement<typeof RowApi> {
  /**
   * The styles of the row can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-row-gap`: The gap between items in the row. Defaults to `--a2ui-spacing-m`.
   */
  static override styles = css`
    :host {
      display: flex;
      flex-direction: row;
      gap: var(--a2ui-row-gap, var(--a2ui-spacing-m));
    }
  `;

  protected createController() {
    return new A2uiController(this, RowApi);
  }

  override updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    const props = this.controller.props;
    if (props) {
      this.style.justifyContent = JUSTIFY_MAP[props.justify ?? ''] ?? 'flex-start';
      this.style.alignItems = ALIGN_MAP[props.align ?? ''] ?? 'stretch';
    }
  }

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const children: ResolvedChildList = Array.isArray(props.children) ? props.children : [];

    return html` ${map(children, child => html`${this.renderNode(child)}`)} `;
  }
}

export const A2uiRow = {
  ...RowApi,
  tagName: 'a2ui-basic-row',
};
