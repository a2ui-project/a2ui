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
import {BasicCatalogComponent} from './basic-catalog-component';
import {ProgressBarApi} from '@a2ui/web_core/v0_9/basic_catalog';

@Component({
  selector: 'a2ui-v09-progress-bar',
  standalone: true,
  imports: [],
  template: `
    <div class="a2ui-progress-bar-container" [class.indeterminate]="isIndeterminate()">
      <div class="a2ui-progress-bar-header">
        @if (label()) {
          <span class="a2ui-progress-bar-label">{{ label() }}</span>
        }
        @if (showPercentage() && !isIndeterminate()) {
          <span class="a2ui-progress-bar-percentage">{{ percentage() }}%</span>
        }
      </div>
      <div
        class="a2ui-progress-bar-track"
        role="progressbar"
        [attr.aria-valuenow]="isIndeterminate() ? null : percentage()"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="a2ui-progress-bar-fill" [style.width.%]="isIndeterminate() ? null : percentage()"></div>
      </div>
    </div>
  `,
  styles: [
    `
      .a2ui-progress-bar-container {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--a2ui-spacing-xs, 4px);
        margin: var(--a2ui-progress-bar-margin, var(--a2ui-spacing-m, 16px));
      }
      .a2ui-progress-bar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .a2ui-progress-bar-label {
        font-size: var(
          --a2ui-progress-bar-label-font-size,
          var(--a2ui-label-font-size, var(--a2ui-font-size-s, 14px))
        );
        font-weight: var(--a2ui-progress-bar-label-font-weight, bold);
        color: var(--a2ui-text-color-text, var(--a2ui-color-on-background, #333));
      }
      .a2ui-progress-bar-percentage {
        font-size: var(--a2ui-progress-bar-percentage-font-size, var(--a2ui-font-size-xs, 12px));
        color: var(--a2ui-progress-bar-percentage-color, var(--a2ui-text-caption-color, #666));
      }
      .a2ui-progress-bar-track {
        width: 100%;
        height: var(--a2ui-progress-bar-height, 8px);
        background: var(--a2ui-progress-bar-track-color, var(--a2ui-color-secondary, #e9ecef));
        border-radius: var(--a2ui-progress-bar-border-radius, 4px);
        overflow: hidden;
      }
      .a2ui-progress-bar-fill {
        height: 100%;
        background: var(--a2ui-progress-bar-fill-color, var(--a2ui-color-primary, #007bff));
        border-radius: var(--a2ui-progress-bar-border-radius, 4px);
        transition: width 0.3s ease;
      }
      .indeterminate .a2ui-progress-bar-fill {
        width: 30% !important;
        animation: a2ui-progress-indeterminate 1.5s ease-in-out infinite;
      }
      @keyframes a2ui-progress-indeterminate {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgressBarComponent extends BasicCatalogComponent<typeof ProgressBarApi> {
  readonly value = computed(() => this.props()['value']?.value() ?? 0);
  readonly max = computed(() => this.props()['max']?.value() ?? 100);
  readonly label = computed(() => this.props()['label']?.value());
  readonly variant = computed(() => this.props()['variant']?.value() ?? 'determinate');
  readonly showPercentage = computed(() => this.props()['showPercentage']?.value() ?? true);

  readonly isIndeterminate = computed(() => this.variant() === 'indeterminate');
  readonly percentage = computed(() => {
    const m = this.max();
    return m > 0 ? Math.min(100, Math.max(0, (this.value() / m) * 100)) : 0;
  });
}
