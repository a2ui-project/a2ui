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

import {CatalogComponent} from '@a2ui/angular';
import {ChangeDetectionStrategy, Component, computed, ViewEncapsulation} from '@angular/core';

import {ProgressBarApi} from './apis';

/** Shows progress toward a goal as a horizontal bar. */
@Component({
  selector: 'app-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The renderer mounts the component in a basic catalog element's shadow
  // root, which document styles don't reach, so the component keeps its
  // styles in a shadow root of its own.
  encapsulation: ViewEncapsulation.ShadowDom,
  styles: `
    .card {
      flex: 1 1 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    }
    .header {
      display: flex;
      justify-content: space-between;
      font-size: 0.9rem;
    }
    .track {
      height: 10px;
      border-radius: 5px;
      background: #e5e7eb;
      overflow: hidden;
    }
    .fill {
      height: 100%;
      background: linear-gradient(90deg, #2563eb, #7c3aed);
      transition: width 0.4s ease;
    }
  `,
  template: `
    <div class="card">
      <div class="header">
        <span>{{ label() }}</span>
        <strong>{{ percent() }}%</strong>
      </div>
      <div
        class="track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="percent()"
        [attr.aria-label]="label()"
      >
        <div class="fill" [style.width.%]="percent()"></div>
      </div>
    </div>
  `,
})
export class ProgressBar extends CatalogComponent<typeof ProgressBarApi> {
  protected readonly label = computed<string>(() => this.props()['label']?.value() ?? '');
  protected readonly percent = computed<number>(() => {
    const value = Number(this.props()['percent']?.value() ?? 0);
    return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  });
}
