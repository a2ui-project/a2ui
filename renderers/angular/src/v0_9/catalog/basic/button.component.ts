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

import {Component, computed, ChangeDetectionStrategy} from '@angular/core';
import {ComponentHostComponent} from '../../core/component-host.component';
import {DataContext} from '@a2ui/web_core/v0_9';
import {BasicCatalogComponent} from './basic-catalog-component';
import {ButtonApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Button component (v0.9).
 *
 * Renders a clickable button with a single child component (usually Text).
 * Dispatches an action when clicked if an `action` property is provided.
 *
 * Supported CSS variables:
 * - `--a2ui-button-padding`: Controls the padding.
 * - `--a2ui-button-border-radius`: Controls the border radius.
 * - `--a2ui-button-border`: Controls the border.
 * - `--a2ui-button-margin`: Controls the margin.
 * - `--a2ui-button-background`: Controls the background color.
 * - `--a2ui-button-box-shadow`: Controls the box shadow.
 * - `--a2ui-button-font-weight`: Controls the font weight.
 */
@Component({
  selector: 'a2ui-v09-button',
  standalone: true,
  imports: [ComponentHostComponent],
  template: `
    <button
      [type]="variant() === 'primary' ? 'submit' : 'button'"
      [class]="'a2ui-button ' + variant()"
      (click)="handleClick()"
      [disabled]="props()['isValid']?.value() === false"
    >
      @if (child()) {
        <a2ui-v09-component-host [componentKey]="child()!" [surfaceId]="surfaceId()">
        </a2ui-v09-component-host>
      }
    </button>
  `,
  styles: [
    `
      .a2ui-button {
        padding: var(
          --a2ui-button-padding,
          var(--a2ui-spacing-m, 0.5rem) var(--a2ui-spacing-l, 1rem)
        );
        border-radius: var(--a2ui-button-border-radius, var(--a2ui-spacing-s, 0.25rem));
        border: var(
          --a2ui-button-border,
          var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
        );
        cursor: pointer;
        margin: var(--a2ui-button-margin, var(--a2ui-spacing-m, 0.5rem));
        background: var(--a2ui-button-background, var(--a2ui-color-surface, #fff));
        box-shadow: var(--a2ui-button-box-shadow, none);
        font-weight: var(--a2ui-button-font-weight, normal);
        --_a2ui-text-margin: 0;
        --_a2ui-text-color: var(--a2ui-color-on-secondary, #333);
        color: var(--_a2ui-text-color);
      }
      .a2ui-button.primary {
        background: var(--a2ui-color-primary, #17e);
        --_a2ui-text-color: var(--a2ui-color-on-primary, #fff);
        color: var(--_a2ui-text-color);
        border: none;
      }
      .a2ui-button.borderless {
        background: none;
        border: none;
        padding: 0;
        color: var(--a2ui-color-primary, #17e);
      }
      .a2ui-button:disabled {
        background-color: #e9ecef;
        color: #6c757d;
        border-color: #ced4da;
        cursor: not-allowed;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ButtonComponent extends BasicCatalogComponent<typeof ButtonApi> {
  readonly variant = computed(() => this.props()['variant']?.value() ?? 'default');
  readonly child = computed(() => this.props()['child']?.value());
  readonly action = computed(() => this.props()['action']?.value());

  handleClick() {
    const action = this.action();
    if (action) {
      const surface = this.surface();
      if (surface) {
        const dataContext = new DataContext(surface, this.dataContextPath());
        const resolvedAction = dataContext.resolveAction(action);
        surface.dispatchAction(resolvedAction, this.componentId());
      }
    }
  }
}
