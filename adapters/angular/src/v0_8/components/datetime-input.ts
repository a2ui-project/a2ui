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
import type {DateTimeInputNode, StringValue} from '../types';

@Component({
  selector: 'a2ui-datetime-input',
  template: `
    <div
      [class]="theme.components.DateTimeInput.container"
      [style]="theme.additionalStyles?.DateTimeInput"
    >
      <label [class]="theme.components.DateTimeInput.label" [for]="inputId">
        {{ resolvedLabel() }}
      </label>
      <input
        [type]="inputType()"
        [class]="theme.components.DateTimeInput.element"
        [id]="inputId"
        [value]="resolvedValue() ?? ''"
        (change)="onChange($event)"
      />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DateTimeInput extends DynamicComponent<DateTimeInputNode> {
  readonly label = input<StringValue | null>(null);
  readonly value = input.required<StringValue | null>();
  readonly enableDate = input<boolean>(true);
  readonly enableTime = input<boolean>(false);

  protected readonly inputId = super.getUniqueId('a2ui-datetime-input');

  protected inputType = computed(() => {
    if (this.enableDate() && this.enableTime()) return 'datetime-local';
    if (this.enableTime()) return 'time';
    return 'date';
  });

  protected readonly resolvedLabel = computed(() => super.resolvePrimitive(this.label()));
  protected resolvedValue = computed(() => super.resolvePrimitive(this.value()));

  onChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const valueNode = this.value();
    if (valueNode && typeof valueNode === 'object' && 'path' in valueNode && valueNode.path) {
      // Update the local data model directly to ensure immediate UI feedback and avoid unnecessary network requests.
      this.processor.processMessages([
        {
          dataModelUpdate: {
            surfaceId: this.surfaceId()!,
            path: this.processor.resolvePath(
              valueNode.path as string,
              this.component().dataContextPath,
            ),
            contents: [{key: '.', valueString: value}],
          },
        },
      ]);
    } else {
      this.handleAction('change', {value});
    }
  }

  private handleAction(name: string, context: Record<string, unknown>) {
    super.sendAction({
      name,
      context: Object.entries(context).map(([key, val]) => ({
        key,
        value: typeof val === 'number' ? {literalNumber: val} : {literalString: String(val)},
      })),
    });
  }
}
