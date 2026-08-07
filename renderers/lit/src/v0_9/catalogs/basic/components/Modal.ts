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
import {customElement, state} from 'lit/decorators.js';
import {ModalApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../../../a2ui-controller.js';

@customElement('a2ui-modal')
export class A2uiLitModal extends BasicCatalogA2uiLitElement<typeof ModalApi> {
  /**
   * The styles of the modal can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-modal-background`: Controls the background of the modal content.
   * - `--a2ui-modal-padding`: Controls the padding of the modal content.
   * - `--a2ui-modal-border-radius`: Controls the border radius of the modal content.
   * - `--a2ui-modal-box-shadow`: Controls the box shadow of the modal content.
   * - `--a2ui-modal-backdrop-bg`: Controls the background of the backdrop.
   */
  static override styles = css`
    :host,
    a2ui-modal {
      display: inline-block;
    }
    .a2ui-modal-wrapper {
      display: inline-block;
    }
    .a2ui-modal-trigger {
      cursor: pointer;
    }
    .a2ui-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: var(--a2ui-modal-backdrop-bg, rgba(0, 0, 0, 0.5));
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .a2ui-modal-content {
      background: var(--a2ui-modal-background, var(--a2ui-color-surface, #fff));
      padding: var(--a2ui-modal-padding, var(--a2ui-spacing-xl, 32px));
      border-radius: var(--a2ui-modal-border-radius, var(--a2ui-border-radius, 8px));
      position: relative;
      min-width: 300px;
      max-width: 80%;
      max-height: 80%;
      overflow-y: auto;
      box-shadow: var(--a2ui-modal-box-shadow, 0 10px 25px rgba(0, 0, 0, 0.2));
    }
    .a2ui-modal-close {
      position: absolute;
      top: 10px;
      right: 15px;
      border: none;
      background: none;
      font-size: 24px;
      cursor: pointer;
      color: var(--a2ui-text-caption-color, #999);
    }
    .a2ui-modal-close:hover {
      color: var(--a2ui-text-color, #333);
    }
  `;

  @state() accessor isOpen = false;

  protected createController() {
    return new A2uiController(this, ModalApi);
  }

  openModal() {
    this.isOpen = true;
  }

  closeModal() {
    this.isOpen = false;
  }

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    return html`
      <div class="a2ui-modal-wrapper">
        <div @click=${() => this.openModal()} class="a2ui-modal-trigger">
          ${props.trigger ? html`${this.renderNode(props.trigger)}` : nothing}
        </div>
        ${this.isOpen
          ? html`
              <div class="a2ui-modal-overlay" @click=${() => this.closeModal()}>
                <div
                  class="a2ui-modal-content"
                  role="dialog"
                  aria-modal="true"
                  @click=${(e: Event) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    class="a2ui-modal-close"
                    aria-label="Close"
                    @click=${() => this.closeModal()}
                  >
                    &times;
                  </button>
                  ${props.content ? html`${this.renderNode(props.content)}` : nothing}
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

export const A2uiModal = {
  ...ModalApi,
  tagName: 'a2ui-modal',
};
