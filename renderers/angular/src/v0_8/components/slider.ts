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
import type {NumberValue, SliderNode, StringValue} from '../types';
import {DynamicComponent} from '../rendering/dynamic-component';

@Component({
  selector: 'a2ui-slider',
  template: `
    <div [class]="theme.components.Slider.container" [style]="theme.additionalStyles?.Slider">
      @if (resolvedLabel()) {
        <label [class]="theme.components.Slider.label" [id]="labelId">{{ resolvedLabel() }}</label>
      }
      <input
        type="range"
        [class]="theme.components.Slider.element"
        [id]="inputId"
        [attr.aria-label]="resolvedLabel() ? resolvedLabel() : 'Slider'"
        [min]="minValue()"
        [max]="maxValue()"
        [value]="resolvedValue() ?? 0"
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
export class Slider extends DynamicComponent<SliderNode> {
  readonly label = input<StringValue | null>(null);
  readonly value = input.required<NumberValue | null>();
  readonly minValue = input<number>(0);
  readonly maxValue = input<number>(100);

  protected readonly inputId = super.getUniqueId('a2ui-slider-input');
  protected readonly labelId = super.getUniqueId('a2ui-slider-label');

  protected resolvedLabel = computed(() => super.resolvePrimitive(this.label()));
  protected resolvedValue = computed(() => super.resolvePrimitive(this.value()));

  onInput(event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
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
            contents: [{key: '.', valueNumber: value}],
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
