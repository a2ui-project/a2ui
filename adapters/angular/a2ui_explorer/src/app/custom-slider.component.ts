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

import {Component, ChangeDetectionStrategy} from '@angular/core';
import {CommonModule} from '@angular/common';
import {CatalogComponent} from 'src/v0_9/core/catalog_component';
import z from 'zod';
import {ComponentApi} from '@a2ui/web_core/v0_9';

const customSliderApi = {
  name: 'CustomSlider',
  schema: z.object({
    label: z.string().optional(),
    value: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }) as any,
} satisfies ComponentApi;

/**
 * A custom component not part of any catalog, used to verify the renderer's
 * ability to handle external component types.
 */
@Component({
  selector: 'a2ui-custom-slider',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="custom-slider-container">
      <label>{{ props()['label']?.value() || 'Value' }}: {{ props()['value']?.value() }}</label>
      <input
        type="range"
        [min]="props()['min']?.value() || 0"
        [max]="props()['max']?.value() || 100"
        [value]="props()['value']?.value() || 0"
        (input)="handleInput($event)"
      />
    </div>
  `,
  styles: [
    `
      .custom-slider-container {
        padding: 10px;
        border: 1px dashed blue;
        border-radius: 4px;
      }
      input {
        width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomSliderComponent extends CatalogComponent<typeof customSliderApi> {
  handleInput(event: Event) {
    const val = Number((event.target as HTMLInputElement).value);
    this.props()['value']?.onUpdate(val);
  }
}

export const customSliderComponentDeclaration = {
  ...customSliderApi,
  component: CustomSliderComponent,
};
