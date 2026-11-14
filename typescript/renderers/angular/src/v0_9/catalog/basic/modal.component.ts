/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  Component,
  computed,
  ChangeDetectionStrategy,
  effect,
  ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import {ComponentHostComponent} from '@a2ui/angular';
import {BasicCatalogComponent} from './basic-catalog-component';
import {ModalApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Modal component (v0.9).
 *
 * Renders a trigger component that opening an overlay containing a content component.
 *
 * The overlay is shown in a native `<dialog>` opened with `showModal()`, so it
 * renders in the browser's top layer: it stays above the host page even when
 * an ancestor creates a stacking context, closes on Escape, and keeps focus
 * inside the modal.
 *
 * Supported CSS variables:
 * - `--a2ui-modal-background`: Controls the background of the modal content.
 * - `--a2ui-modal-padding`: Controls the padding of the modal content.
 * - `--a2ui-modal-border-radius`: Controls the border radius of the modal content.
 * - `--a2ui-modal-box-shadow`: Controls the box shadow of the modal content.
 * - `--a2ui-modal-backdrop-bg`: Controls the background of the backdrop.
 */
@Component({
  selector: 'a2ui-v09-modal',
  standalone: true,
  imports: [ComponentHostComponent],
  template: `
    <div class="a2ui-modal-wrapper">
      <div (click)="openModal()" class="a2ui-modal-trigger">
        @if (trigger()) {
          <a2ui-v09-component-host [componentKey]="trigger()!" [surfaceId]="surfaceId()">
          </a2ui-v09-component-host>
        }
      </div>

      @if (isOpen()) {
        <dialog #dialog class="a2ui-modal-dialog" (close)="closeModal()">
          <div class="a2ui-modal-overlay" (click)="closeModal()">
            <div class="a2ui-modal-content" (click)="$event.stopPropagation()">
              <button
                type="button"
                class="a2ui-modal-close"
                aria-label="Close"
                (click)="closeModal()"
              >
                &times;
              </button>
              @if (content()) {
                <a2ui-v09-component-host [componentKey]="content()!" [surfaceId]="surfaceId()">
                </a2ui-v09-component-host>
              }
            </div>
          </div>
        </dialog>
      }
    </div>
  `,
  styles: [
    `
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
        background: var(--a2ui-modal-background, var(--a2ui-color-surface, white));
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
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalComponent extends BasicCatalogComponent<typeof ModalApi> {
  isOpen = signal(false);

  readonly trigger = computed(() => this.props()['trigger']?.value());
  readonly content = computed(() => this.props()['content']?.value());

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    super();
    // Show the dialog as modal once it is rendered, which moves it to the top
    // layer. Environments without `showModal()` (e.g. jsdom) get a plain
    // open dialog instead.
    effect(() => {
      const dialog = this.dialog()?.nativeElement;
      if (!dialog || dialog.open) return;
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    });
  }

  openModal() {
    this.isOpen.set(true);
  }

  closeModal() {
    this.isOpen.set(false);
  }
}
