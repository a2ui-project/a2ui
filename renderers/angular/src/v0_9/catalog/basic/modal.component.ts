/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
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
  signal,
  ElementRef,
  HostListener,
  ViewChild,
} from '@angular/core';
import {ComponentHostComponent} from '../../core/component-host.component';
import {BasicCatalogComponent} from './basic-catalog-component';
import {ModalApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Modal component (v0.9).
 *
 * Renders a trigger component that opening an overlay containing a content component.
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
      <div #modalTrigger (click)="openModal()" class="a2ui-modal-trigger">
        @if (trigger()) {
          <a2ui-v09-component-host [componentKey]="trigger()!" [surfaceId]="surfaceId()">
          </a2ui-v09-component-host>
        }
      </div>

      @if (isOpen()) {
        <div class="a2ui-modal-overlay" (click)="closeModal()">
          <div
            #modalContent
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="props()['accessibility']?.value()?.label"
            [attr.aria-describedby]="
              props()['accessibility']?.value()?.description ? uniqueId + '-description' : null
            "
            class="a2ui-modal-content"
            (click)="$event.stopPropagation()"
          >
            <button class="a2ui-modal-close" aria-label="Close" (click)="closeModal()">
              &times;
            </button>
            @if (content()) {
              <a2ui-v09-component-host [componentKey]="content()!" [surfaceId]="surfaceId()">
              </a2ui-v09-component-host>
            }
            @if (props()['accessibility']?.value()?.description) {
              <span [id]="uniqueId + '-description'" style="display: none;">
                {{ props()['accessibility']?.value()?.description }}
              </span>
            }
          </div>
        </div>
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

  @ViewChild('modalTrigger') triggerElement!: ElementRef<HTMLDivElement>;
  @ViewChild('modalContent') modalContentElement!: ElementRef<HTMLDivElement>;

  openModal() {
    this.isOpen.set(true);
    setTimeout(() => {
      if (this.modalContentElement) {
        const focusables = this.modalContentElement.nativeElement.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex="0"]',
        );
        if (focusables.length > 0) {
          (focusables[0] as HTMLElement).focus();
        }
      }
    });
  }

  closeModal() {
    this.isOpen.set(false);
    setTimeout(() => {
      if (this.triggerElement) {
        const focusable = this.triggerElement.nativeElement.querySelector(
          'button, [tabindex="0"], input, select, textarea',
        ) as HTMLElement;
        if (focusable) {
          focusable.focus();
        }
      }
    });
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (!this.isOpen()) return;

    if (event.key === 'Escape') {
      this.closeModal();
      return;
    }

    if (event.key === 'Tab' && this.modalContentElement) {
      const focusables = this.modalContentElement.nativeElement.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex="0"]',
      );
      if (focusables.length === 0) return;
      const first = focusables[0] as HTMLElement;
      const last = focusables[focusables.length - 1] as HTMLElement;

      if (event.shiftKey) {
        if (document.activeElement === first) {
          last.focus();
          event.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first.focus();
          event.preventDefault();
        }
      }
    }
  }
}
