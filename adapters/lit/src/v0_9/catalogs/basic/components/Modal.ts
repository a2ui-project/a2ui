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
import {customElement, query} from 'lit/decorators.js';
import {ModalApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '@a2ui/lit/v0_9';

@customElement('a2ui-modal')
export class A2uiLitModal extends BasicCatalogA2uiLitElement<typeof ModalApi> {
  /**
   * The styles of the modal can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-modal-backdrop-bg`: Controls the backdrop color of the dialog.
   * - `--a2ui-modal-padding`: Padding inside the dialog content area. Defaults to `24px`.
   * - `--a2ui-modal-border-radius`: Border radius of the dialog. Defaults to `8px`.
   */
  static styles = css`
    :host {
      display: inline-block;
    }
    dialog {
      border: 1px solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-modal-border-radius, 8px);
      padding: var(--a2ui-modal-padding, 24px);
      min-width: 300px;
      background: var(--a2ui-color-surface, #fff);
    }
    dialog::backdrop {
      background: var(--a2ui-modal-backdrop-bg, rgba(0, 0, 0, 0.5));
    }
  `;

  protected createController() {
    return new A2uiController(this, ModalApi);
  }
  @query('dialog') accessor dialog!: HTMLDialogElement;

  render() {
    const props = this.controller.props;
    if (!props) return nothing;

    return html`
      <div @click=${() => this.dialog?.showModal()} style="display: contents;">
        ${props.trigger ? html`${this.renderNode(props.trigger)}` : nothing}
      </div>
      <dialog class="a2ui-modal">
        <form method="dialog" style="text-align: right;">
          <button>×</button>
        </form>
        ${props.content ? html`${this.renderNode(props.content)}` : nothing}
      </dialog>
    `;
  }
}

export const A2uiModal = {
  ...ModalApi,
  tagName: 'a2ui-modal',
};
