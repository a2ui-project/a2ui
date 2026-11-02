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
import {state} from 'lit/decorators.js';
import {createRef, ref} from 'lit/directives/ref.js';
import {BasicCatalogA2uiLitElement} from './basic-catalog-a2ui-lit-element.js';
import type {ModalSupportedApis} from './supported_apis.js';

export class A2uiLitModal extends BasicCatalogA2uiLitElement<ModalSupportedApis> {
  /** @nocollapse */
  static readonly tagName = 'a2ui-modal';
  /**
   * The overlay is shown in a native `<dialog>` opened with `showModal()`, so
   * it renders in the browser's top layer: it stays above the host page even
   * when an ancestor creates a stacking context, closes on Escape, and keeps
   * focus inside the modal.
   *
   * The styles of the modal can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-modal-background`: Controls the background of the modal content.
   * - `--a2ui-modal-padding`: Controls the padding of the modal content.
   * - `--a2ui-modal-border-radius`: Controls the border radius of the modal content.
   * - `--a2ui-modal-box-shadow`: Controls the box shadow of the modal content.
   * - `--a2ui-modal-backdrop-bg`: Controls the background of the backdrop.
   *
   * @nocollapse
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
    .a2ui-modal-dialog {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      overflow: visible;
    }
    .a2ui-modal-dialog::backdrop {
      background: transparent;
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

  @state() isOpen = false;

  private readonly dialogRef = createRef<HTMLDialogElement>();

  openModal() {
    this.isOpen = true;
  }

  closeModal() {
    this.isOpen = false;
  }

  override updated(changed: Map<PropertyKey, unknown>) {
    super.updated(changed);
    // Show the dialog as modal once it is rendered, which moves it to the top
    // layer. Environments without `showModal()` (e.g. jsdom) get a plain open
    // dialog instead.
    const dialog = this.dialogRef.value;
    if (!this.isOpen || !dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
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
              <dialog
                ${ref(this.dialogRef)}
                class="a2ui-modal-dialog"
                @close=${() => this.closeModal()}
              >
                <div class="a2ui-modal-overlay" @click=${() => this.closeModal()}>
                  <div class="a2ui-modal-content" @click=${(e: Event) => e.stopPropagation()}>
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
              </dialog>
            `
          : nothing}
      </div>
    `;
  }
}

export {A2uiLitModal as A2uiModalElement};
