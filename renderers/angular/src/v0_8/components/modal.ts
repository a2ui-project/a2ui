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

import {ChangeDetectionStrategy, Component, input, signal} from '@angular/core';
import {DynamicComponent} from '../rendering/dynamic-component';
import {Renderer} from '../rendering/renderer';
import type {AnyComponentNode, ModalNode} from '../types';

@Component({
  selector: 'a2ui-modal',
  imports: [Renderer],
  template: `
    <div class="a2ui-modal-entry-point" (click)="openModal()">
      @if (entryPointChild()) {
        <ng-container a2ui-renderer [surfaceId]="surfaceId()!" [component]="entryPointChild()!" />
      }
    </div>

    @if (isOpen()) {
      <div
        class="a2ui-modal-overlay"
        [class]="theme.components.Modal.backdrop"
        (click)="closeModal()"
      >
        <div
          class="a2ui-modal-content"
          [class]="theme.components.Modal.element"
          (click)="$event.stopPropagation()"
        >
          <button class="a2ui-modal-close" (click)="closeModal()">&times;</button>
          @if (contentChild()) {
            <ng-container a2ui-renderer [surfaceId]="surfaceId()!" [component]="contentChild()!" />
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: inline-block;
    }
    .a2ui-modal-entry-point {
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Modal extends DynamicComponent<ModalNode> {
  readonly entryPointChild = input.required<AnyComponentNode>();
  readonly contentChild = input.required<AnyComponentNode>();

  protected readonly isOpen = signal(false);

  openModal() {
    this.isOpen.set(true);
  }

  closeModal() {
    this.isOpen.set(false);
  }
}
