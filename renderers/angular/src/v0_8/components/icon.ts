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

import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {DynamicComponent} from '../rendering/dynamic-component';
import type {IconNode, StringValue} from '../types';

@Component({
  selector: 'a2ui-icon',
  host: {
    'aria-hidden': 'true',
    tabindex: '-1',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      flex: var(--weight);
      min-height: 0;
      overflow: auto;
    }
  `,
  template: `
    @let resolvedName = this.resolvedName();

    @if (resolvedName) {
      <section [class]="theme.components.Icon" [style]="theme.additionalStyles?.Icon">
        <span class="g-icon">{{ resolvedName }}</span>
      </section>
    }
  `,
})
export class Icon extends DynamicComponent<IconNode> {
  readonly name = input<StringValue | null>(null);

  // g-icon uses snake_case for the icon names. We convert camelCase and TitleCase here.
  protected readonly resolvedName = computed(() => {
    const rawName = this.resolvePrimitive(this.name());
    if (!rawName) return '';
    return this.toSnakeCase(rawName);
  });

  private toSnakeCase(str: string): string {
    return str
      .replace(/^[A-Z]/, letter => letter.toLowerCase())
      .replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
