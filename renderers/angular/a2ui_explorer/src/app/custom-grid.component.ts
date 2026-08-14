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

import {Component, ChangeDetectionStrategy, computed} from '@angular/core';
import {CommonModule} from '@angular/common';
import {
  CatalogComponent,
  ComponentHostComponent,
  createComponentImplementation,
} from '@a2ui/angular/v0_9';
import z from 'zod';
import {ComponentApi, DynamicStringSchema, ChildListSchema} from '@a2ui/web_core/v0_9';

const customGridApi = {
  name: 'CustomGrid',
  schema: z.object({
    title: DynamicStringSchema.optional(),
    description: DynamicStringSchema.optional(),
    children: ChildListSchema.optional(),
  }),
} satisfies ComponentApi;

/**
 * A custom container component written in native Angular.
 * Demonstrates a 2x2 grid layout capable of instantiating up to four child
 * components (either native Angular components or universal web components).
 */
@Component({
  selector: 'a2ui-custom-grid',
  standalone: true,
  imports: [CommonModule, ComponentHostComponent],
  template: `
    <div class="custom-grid-wrapper">
      @if (props()['title']?.value(); as title) {
        <div class="grid-header">
          <h3 class="grid-title">{{ title }}</h3>
          @if (props()['description']?.value(); as description) {
            <p class="grid-description">{{ description }}</p>
          }
        </div>
      }
      <div class="custom-grid-container">
        @for (child of gridSlots(); track $index) {
          <div class="grid-cell" [class.has-content]="!!child" [class.empty-cell]="!child">
            <div class="cell-badge">Slot {{ $index + 1 }}</div>
            @if (child) {
              <div class="cell-content">
                <a2ui-v09-component-host
                  [surfaceId]="surfaceId()"
                  [componentKey]="child"
                ></a2ui-v09-component-host>
              </div>
            } @else {
              <div class="empty-placeholder">
                <span>Empty child</span>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .custom-grid-wrapper {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        border: 2px dashed #4f46e5;
        border-radius: 12px;
        background-color: #f8fafc;
        color: #1e293b;
        box-sizing: border-box;
        width: 100%;
      }

      .grid-header {
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 8px;
      }

      .grid-title {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: #312e81;
      }

      .grid-description {
        margin: 4px 0 0;
        font-size: 0.85rem;
        color: #64748b;
      }

      .custom-grid-container {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        grid-template-rows: repeat(2, 1fr);
        gap: 16px;
        min-height: 240px;
      }

      @media (max-width: 600px) {
        .custom-grid-container {
          grid-template-columns: 1fr;
          grid-template-rows: auto;
        }
      }

      .grid-cell {
        position: relative;
        display: flex;
        flex-direction: column;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background-color: #ffffff;
        padding: 12px;
        min-height: 100px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }

      .grid-cell.empty-cell {
        border-style: dashed;
        background-color: #f1f5f9;
        justify-content: center;
        align-items: center;
      }

      .cell-badge {
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6366f1;
        margin-bottom: 8px;
      }

      .cell-content {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .empty-placeholder {
        color: #94a3b8;
        font-size: 0.8rem;
        font-style: italic;
      }

      @media (prefers-color-scheme: dark) {
        .custom-grid-wrapper {
          background-color: #1e293b;
          color: #f8fafc;
          border-color: #818cf8;
        }

        .grid-header {
          border-bottom-color: #334155;
        }

        .grid-title {
          color: #c7d2fe;
        }

        .grid-description {
          color: #cbd5e1;
        }

        .grid-cell {
          background-color: #0f172a;
          border-color: #475569;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        }

        .grid-cell.empty-cell {
          background-color: #1e293b;
        }

        .cell-badge {
          color: #a5b4fc;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomGridComponent extends CatalogComponent<typeof customGridApi> {
  protected readonly gridSlots = computed(() => {
    const children = this.props()['children']?.value() ?? [];
    return [children[0] ?? null, children[1] ?? null, children[2] ?? null, children[3] ?? null];
  });
}

export const customGridComponentDeclaration = createComponentImplementation(
  customGridApi,
  CustomGridComponent,
);
