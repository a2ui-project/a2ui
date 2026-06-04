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
import {CardApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '@a2ui/lit/v0_9';

@customElement('a2ui-card')
export class A2uiCardElement extends BasicCatalogA2uiLitElement<typeof CardApi> {
  /**
   * The styles of the card can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-card-border`: The styling for the card border. Defaults to `--a2ui-border-width` width and `--a2ui-color-border` color.
   * - `--a2ui-card-border-radius`: The border radius of the card. Defaults to `--a2ui-border-radius`.
   * - `--a2ui-card-padding`: The padding of the card. Defaults to `--a2ui-spacing-m`.
   * - `--a2ui-card-box-shadow`: The box shadow of the card. Defaults to `0 2px 4px rgba(0,0,0,0.1)`.
   * - `--a2ui-card-margin`: The outer margin of the card. Defaults to `--a2ui-spacing-m`.
   */
  static styles = css`
    :host {
      display: block;
      border: var(
        --a2ui-card-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      border-radius: var(--a2ui-card-border-radius, var(--a2ui-border-radius, 8px));
      padding: var(--a2ui-card-padding, var(--a2ui-spacing-m, 16px));
      background: var(--a2ui-card-background, var(--a2ui-color-surface, #fff));
      color: var(--a2ui-color-on-surface, #333);
      box-shadow: var(--a2ui-card-box-shadow, 0 2px 4px rgba(0, 0, 0, 0.1));
      margin: var(--a2ui-card-margin, var(--a2ui-spacing-m));
    }
  `;

  protected createController() {
    return new A2uiController(this, CardApi);
  }

  render() {
    const props = this.controller.props;
    if (!props) return nothing;

    return html` ${props.child ? html`${this.renderNode(props.child)}` : nothing} `;
  }
}

export const A2uiCard = {
  ...CardApi,
  tagName: 'a2ui-card',
};
