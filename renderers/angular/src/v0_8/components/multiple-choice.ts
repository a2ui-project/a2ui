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
import type {AnyComponentNode, MultipleChoiceNode, StringValue} from '../types';

@Component({
  selector: 'a2ui-multiple-choice',
  template: `
    <div
      [class]="theme.components.MultipleChoice.container"
      [style]="theme.additionalStyles?.MultipleChoice"
    >
      <label [class]="theme.components.MultipleChoice.label" [for]="selectId">
        {{ resolvedLabel() }}
      </label>
      <select
        [class]="theme.components.MultipleChoice.element"
        [id]="selectId"
        [value]="resolvedSelections()[0] || ''"
        (change)="onChange($event)"
      >
        @for (option of resolvedOptions(); track option.value) {
          <option [value]="option.value">{{ option.label }}</option>
        }
      </select>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultipleChoice extends DynamicComponent<MultipleChoiceNode> {
  readonly label = input<StringValue | null>(null);
  readonly options = input.required<{label: StringValue; value: string}[]>();
  readonly selections = input.required<AnyComponentNode | null>();

  protected readonly selectId = super.getUniqueId('a2ui-multiple-choice');

  protected readonly resolvedLabel = computed(() => this.resolvePrimitive(this.label()));

  protected readonly resolvedOptions = computed(() =>
    this.options().map(opt => ({
      label: this.resolvePrimitive(opt.label),
      value: opt.value,
    })),
  );

  protected readonly resolvedSelections = computed(() => {
    const s = this.selections();
    if (s && typeof s === 'object' && 'literalArray' in s) {
      return (s as any).literalArray as string[];
    }
    return [];
  });

  onChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    const selectionsNode = this.selections();
    if (
      selectionsNode &&
      typeof selectionsNode === 'object' &&
      'path' in selectionsNode &&
      selectionsNode.path
    ) {
      // Update the local data model directly to ensure immediate UI feedback and avoid unnecessary network requests.
      this.processor.processMessages([
        {
          dataModelUpdate: {
            surfaceId: this.surfaceId()!,
            path: this.processor.resolvePath(
              selectionsNode.path as string,
              this.component().dataContextPath,
            ),
            contents: [{key: '.', valueString: JSON.stringify({literalArray: [value]})}],
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
