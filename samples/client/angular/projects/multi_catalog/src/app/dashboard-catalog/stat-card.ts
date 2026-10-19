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

import {StatCardApi} from './apis';

/** Shows one headline number with a label and an optional caption. */
@Component({
  selector: 'app-stat-card',
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
      gap: 4px;
      padding: 16px;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    }
    .label {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    .value {
      font-size: 2rem;
      font-weight: 700;
    }
    .caption {
      font-size: 0.85rem;
      color: #2563eb;
    }
  `,
  template: `
    <div class="card">
      <span class="label">{{ label() }}</span>
      <span class="value">{{ value() }}</span>
      @if (caption()) {
        <span class="caption">{{ caption() }}</span>
      }
    </div>
  `,
})
export class StatCard extends CatalogComponent<typeof StatCardApi> {
  protected readonly label = computed<string>(() => this.props()['label']?.value() ?? '');
  protected readonly value = computed<string>(() => this.props()['value']?.value() ?? '');
  protected readonly caption = computed<string>(() => this.props()['caption']?.value() ?? '');
}
