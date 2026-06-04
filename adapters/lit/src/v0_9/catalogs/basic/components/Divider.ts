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
import {classMap} from 'lit/directives/class-map.js';
import {DividerApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {A2uiController} from '@a2ui/lit/v0_9';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';

@customElement('a2ui-divider')
export class A2uiDividerElement extends BasicCatalogA2uiLitElement<typeof DividerApi> {
  /**
   * The styles of the divider can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-divider-border`: The styling for the divider border. Defaults to `--a2ui-border-width` solid `--a2ui-color-border`.
   * - `--a2ui-divider-spacing`: The spacing around the divider. Defaults to `--a2ui-spacing-m`.
   */
  static styles = css`
    :host {
      display: block;
      align-self: stretch;
    }
    .a2ui-divider.horizontal {
      height: 0;
      overflow: hidden;
      font-size: 0.1px;
      line-height: 0;
      border: 0;
      border-top: var(
        --a2ui-divider-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      margin: var(--a2ui-divider-spacing, var(--a2ui-spacing-m, 0.5rem)) 0;
      width: 100%;
    }
    .a2ui-divider.vertical {
      width: var(--a2ui-border-width, 1px);
      background-color: var(--a2ui-color-border, #ccc);
      height: 100%;
      margin: 0 var(--a2ui-divider-spacing, var(--a2ui-spacing-m, 0.5rem));
    }
  `;

  protected createController() {
    return new A2uiController(this, DividerApi);
  }

  render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const classes = {
      'a2ui-divider': true,
      vertical: props.axis === 'vertical',
      horizontal: props.axis !== 'vertical',
    };

    return props.axis === 'vertical'
      ? html`<div class=${classMap(classes)}></div>`
      : html`<hr class=${classMap(classes)} />`;
  }
}

export const A2uiDivider = {
  ...DividerApi,
  tagName: 'a2ui-divider',
};
