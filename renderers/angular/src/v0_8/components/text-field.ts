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
import type {ResolvedTextField, StringValue, TextFieldNode} from '../types';

@Component({
  selector: 'a2ui-text-field',
  template: `
    <div [class]="theme.components.TextField.container" [style]="theme.additionalStyles?.TextField">
      <label [class]="theme.components.TextField.label" [for]="inputId">
        {{ resolvedLabel() }}
      </label>
      <input
        [type]="htmlInputType()"
        [class]="theme.components.TextField.element"
        [id]="inputId"
        [value]="resolvedText() ?? ''"
        (input)="onInput($event)"
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
export class TextField extends DynamicComponent<TextFieldNode> {
  readonly label = input.required<StringValue | null>();
  readonly text = input<StringValue | null>(null);
  readonly textFieldType = input<ResolvedTextField['textFieldType']>('shortText');

  protected readonly inputId = super.getUniqueId('a2ui-text-field');

  protected resolvedLabel = computed(() => super.resolvePrimitive(this.label()));
  protected resolvedText = computed(() => super.resolvePrimitive(this.text()));

  protected htmlInputType = computed(() => {
    switch (this.textFieldType()) {
      case 'number':
        return 'number';
      case 'date':
        return 'date';
      default:
        return 'text';
    }
  });

  onInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const textNode = this.text();
    if (textNode && typeof textNode === 'object' && 'path' in textNode && textNode.path) {
      // Update the local data model directly to ensure immediate UI feedback and avoid unnecessary network requests.
      this.processor.processMessages([
        {
          dataModelUpdate: {
            surfaceId: this.surfaceId()!,
            path: this.processor.resolvePath(
              textNode.path as string,
              this.component().dataContextPath,
            ),
            contents: [{key: '.', valueString: value}],
          },
        },
      ]);
    } else {
      this.handleAction('input', {value});
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
