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
import type {BooleanValue, CheckboxNode, StringValue} from '../types';

@Component({
  selector: 'a2ui-checkbox',
  template: `
    <label>
      <input
        type="checkbox"
        [id]="inputId"
        [checked]="inputChecked()"
        (change)="onToggle($event)"
      />
      {{ resolvedLabel() }}
    </label>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Checkbox extends DynamicComponent<CheckboxNode> {
  readonly label = input.required<StringValue | null>();
  readonly value = input.required<BooleanValue | null>();

  protected inputChecked = computed(() => super.resolvePrimitive(this.value()) ?? false);
  protected resolvedLabel = computed(() => super.resolvePrimitive(this.label()));
  protected readonly inputId = super.getUniqueId('a2ui-checkbox');

  onToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    const checkedNode = this.value();
    if (
      checkedNode &&
      typeof checkedNode === 'object' &&
      'path' in checkedNode &&
      checkedNode.path
    ) {
      // Update the local data model directly to ensure immediate UI feedback and avoid unnecessary network requests.
      this.processor.processMessages([
        {
          dataModelUpdate: {
            surfaceId: this.surfaceId()!,
            path: this.processor.resolvePath(
              checkedNode.path as string,
              this.component().dataContextPath,
            ),
            contents: [{key: '.', valueBoolean: checked}],
          },
        },
      ]);
    } else {
      this.sendAction({
        name: 'toggle',
        context: [{key: 'checked', value: {literalBoolean: checked}}],
      });
    }
  }
}
