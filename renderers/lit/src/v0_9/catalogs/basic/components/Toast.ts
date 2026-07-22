/*
 * Copyright 2026 Google LLC
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
import {ToastApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../../../a2ui-controller.js';

@customElement('a2ui-toast')
export class A2uiToastElement extends BasicCatalogA2uiLitElement<typeof ToastApi> {
  static override styles = css`
    :host {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      font-family: inherit;
    }
    .toast {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      color: #fff;
      font-size: 0.875rem;
      min-width: 250px;
    }
    .toast-info {
      background-color: #2196f3;
    }
    .toast-success {
      background-color: #4caf50;
    }
    .toast-warning {
      background-color: #ff9800;
    }
    .toast-error {
      background-color: #f44336;
    }
  `;

  protected createController() {
    return new A2uiController(this, ToastApi);
  }

  override render() {
    const props = this.controller.props;
    if (!props || !props.message) return nothing;

    const variant = props.variant || 'info';

    return html`
      <div class="toast toast-${variant}">
        <span class="toast-message">${props.message}</span>
      </div>
    `;
  }
}

export const A2uiToast = {
  ...ToastApi,
  tagName: 'a2ui-toast',
};
