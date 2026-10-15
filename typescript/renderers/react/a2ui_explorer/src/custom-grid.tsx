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

import {createComponentImplementation} from '@a2ui/react/v0_9';
import z from 'zod';
import {type ComponentApi, DynamicStringSchema, ChildListSchema} from '@a2ui/web_core/v0_9';
import './custom-grid.css';

export const customGridApi = {
  name: 'CustomGrid',
  schema: z.object({
    title: DynamicStringSchema.optional(),
    description: DynamicStringSchema.optional(),
    children: ChildListSchema.optional(),
  }),
} satisfies ComponentApi;

/**
 * A custom container component written in native React.
 * Demonstrates a 2x2 grid layout capable of instantiating up to four child
 * components (either native React components or universal web components).
 */
export const customGridComponent = createComponentImplementation(
  customGridApi,
  ({props, buildChild}) => {
    const title = props.title;
    const description = props.description;
    const children = (props.children ?? []) as string[];
    const slots = [
      children[0] ?? null,
      children[1] ?? null,
      children[2] ?? null,
      children[3] ?? null,
    ];

    return (
      <div className="custom-grid-wrapper">
        {title && (
          <div className="grid-header">
            <h3 className="grid-title">{title}</h3>
            {description && <p className="grid-description">{description}</p>}
          </div>
        )}
        <div className="custom-grid-container">
          {slots.map((childId, index) => (
            <div key={index} className={`grid-cell ${childId ? 'has-content' : 'empty-cell'}`}>
              <div className="cell-badge">Slot {index + 1}</div>
              {childId ? (
                <div className="cell-content">{buildChild(childId)}</div>
              ) : (
                <div className="empty-placeholder">
                  <span>Empty child</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  },
);
