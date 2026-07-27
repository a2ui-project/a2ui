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

import {html, nothing, css, PropertyValues} from 'lit';
import {customElement, query} from 'lit/decorators.js';
import {DialogApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../../../a2ui-controller.js';

@customElement('a2ui-dialog')
export class A2uiDialogElement extends BasicCatalogA2uiLitElement<typeof DialogApi> {
  @query('dialog') accessor dialogElement!: HTMLDialogElement;
  static override styles = css`
    :host {
      display: block;
    }
    dialog {
      border: var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-border-radius, 12px);
      padding: var(--a2ui-spacing-l, 24px);
      background-color: var(--a2ui-color-surface, #fff);
      color: var(--a2ui-color-on-surface, #333);
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
      max-width: 500px;
      width: 90%;
    }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(2px);
    }
    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--a2ui-spacing-m, 16px);
    }
    .dialog-title {
      font-size: var(--a2ui-font-size-l, 1.25rem);
      font-weight: 600;
      margin: 0;
    }
    .close-btn {
      background: none;
      border: none;
      font-size: 1.25rem;
      cursor: pointer;
      color: var(--a2ui-color-on-surface, #666);
    }
  `;

  protected createController() {
    return new A2uiController(this, DialogApi);
  }

  override updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    const isOpen = Boolean(this.controller.props?.open);
    if (this.dialogElement) {
      if (isOpen && !this.dialogElement.open) {
        this.dialogElement.showModal();
      } else if (!isOpen && this.dialogElement.open) {
        this.dialogElement.close();
      }
    }
  }

  private handleNativeClose() {
    this.closeDialog();
  }

  private closeDialog() {
    this.dispatchEvent(
      new CustomEvent('a2uiclose', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    return html`
      <dialog @close=${this.handleNativeClose}>
        <div class="dialog-header">
          ${props.title ? html`<h3 class="dialog-title">${props.title}</h3>` : nothing}
          <button class="close-btn" @click=${this.closeDialog}>&times;</button>
        </div>
        <div class="dialog-body">
          ${props.child ? html`${this.renderNode(props.child)}` : nothing}
        </div>
      </dialog>
    `;
  }
}

export const A2uiDialog = {
  ...DialogApi,
  tagName: 'a2ui-dialog',
};
