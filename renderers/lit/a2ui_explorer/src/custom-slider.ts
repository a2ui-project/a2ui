/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {html, css, nothing} from 'lit';
import {customElement} from 'lit/decorators.js';
import {z} from 'zod';
import {A2uiLitElement, createComponentImplementation} from '@a2ui/lit/v0_9';
import {ComponentApi, DynamicStringSchema, DynamicNumberSchema} from '@a2ui/web_core/v0_9';

export const customSliderApi = {
  name: 'CustomSlider',
  schema: z.object({
    label: DynamicStringSchema.optional(),
    value: DynamicNumberSchema.optional(),
    min: DynamicNumberSchema.optional(),
    max: DynamicNumberSchema.optional(),
  }),
} satisfies ComponentApi;

/**
 * A custom component demonstrating external component registration in Lit.
 */
@customElement('a2ui-custom-slider')
export class CustomSliderComponent extends A2uiLitElement<typeof customSliderApi> {
  static override styles = css`
    .custom-slider-container {
      padding: 10px;
      border: 1px dashed #3b82f6;
      border-radius: 6px;
      background: rgba(59, 130, 246, 0.05);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 0.85rem;
      font-weight: 500;
      color: #3b82f6;
    }
    input[type='range'] {
      width: 100%;
      cursor: pointer;
    }
  `;

  override createRenderRoot() {
    return this;
  }

  protected readonly api = customSliderApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const label = props.label ?? 'Value';
    const value = props.value ?? 0;
    const min = props.min ?? 0;
    const max = props.max ?? 100;

    return html`
      <div class="custom-slider-container">
        <label>${label}: ${value}</label>
        <input
          type="range"
          min="${min}"
          max="${max}"
          .value="${String(value)}"
          @input="${(e: Event) => props.setValue?.(Number((e.target as HTMLInputElement).value))}"
        />
      </div>
    `;
  }
}

export const customSliderComponent = createComponentImplementation(
  customSliderApi,
  CustomSliderComponent,
);
