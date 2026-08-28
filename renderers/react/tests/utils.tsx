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

import React from 'react';
import {render} from '@testing-library/react';
import {z} from 'zod';
import {SurfaceModel, ComponentModel, Catalog, extractRefFields} from '@a2ui/web_core/v0_9';
import {BASIC_FUNCTIONS} from '@a2ui/web_core/v0_9/basic_catalog';
import {A2uiSurface} from '../src/v0_9/A2uiSurface';
import {createComponentImplementation} from '../src/v0_9/adapter';
import type {ReactComponentImplementation} from '../src/v0_9/adapter';

/** The resolver builds its tree from the component with this id. */
const ROOT_ID = 'root';

const STUB_TYPE = '__TestChild';

/**
 * Stands in for a child a test referenced but did not define, so a test can
 * assert that the component under test asked for that child without also
 * defining a component to receive it.
 */
const StubChild = createComponentImplementation(
  {name: STUB_TYPE, schema: z.object({})},
  ({context}) => (
    <div
      data-testid={`child-${context.componentModel.id}`}
      data-basepath={context.dataContext.path}
    />
  ),
);

export interface RenderA2uiOptions {
  initialData?: Record<string, any>;
  /** Additional component implementations needed by the children */
  additionalImpls?: ReactComponentImplementation[];
  /** Pre-instantiated ComponentModels for child components */
  additionalComponents?: ComponentModel[];
  /** Functions to include in the catalog */
  functions?: any[];
}

/**
 * Renders one component through `A2uiSurface`, the way an application does.
 *
 * The component under test is the surface's root. Any child it references
 * that the test did not define renders as a stub carrying
 * `data-testid="child-<id>"`, so a test can assert which children the
 * component asked for.
 */
export function renderA2uiComponent(
  impl: ReactComponentImplementation,
  initialProperties: Record<string, any>,
  options: RenderA2uiOptions = {},
) {
  const {
    initialData = {},
    additionalImpls = [],
    additionalComponents = [],
    functions = BASIC_FUNCTIONS,
  } = options;

  const catalog = new Catalog<ReactComponentImplementation>(
    'test-catalog',
    [impl, ...additionalImpls, StubChild],
    functions,
  );
  const surface = new SurfaceModel<ReactComponentImplementation>('test-surface', catalog);

  surface.dataModel.set('/', initialData);

  const mainModel = new ComponentModel(ROOT_ID, impl.name, initialProperties);
  surface.componentsModel.addComponent(mainModel);

  for (const childModel of additionalComponents) {
    surface.componentsModel.addComponent(childModel);
  }

  for (const id of referencedChildIds(impl.schema, initialProperties)) {
    if (!surface.componentsModel.get(id)) {
      surface.componentsModel.addComponent(new ComponentModel(id, STUB_TYPE, {}));
    }
  }

  const view = render(<A2uiSurface surface={surface} />);

  return {
    view,
    surface,
    mainModel,
    // Helper to trigger data model updates and wait for re-render
    updateData: async (path: string, value: any) => {
      surface.dataModel.set(path, value);
      // Wait for React to process the useSyncExternalStore update
      await new Promise(resolve => setTimeout(resolve, 0));
    },
  };
}

/**
 * The child component ids a payload references, found through the same schema
 * classification the resolver uses, so a stub is created for exactly the
 * properties the resolver will try to resolve.
 */
function referencedChildIds(
  schema: z.ZodTypeAny,
  properties: Record<string, unknown>,
): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) {
      ids.add(value);
    }
  };

  for (const [key, ref] of extractRefFields(schema)) {
    const value = properties[key];
    switch (ref.kind) {
      case 'single':
        add(value);
        break;
      case 'list':
        if (Array.isArray(value)) {
          for (const item of value) {
            add(item);
            if (item && typeof item === 'object') {
              add((item as Record<string, unknown>).componentId);
            }
          }
        } else if (value && typeof value === 'object') {
          // A template child list: {componentId, path}.
          add((value as Record<string, unknown>).componentId);
        }
        break;
      case 'nested':
        if (Array.isArray(value)) {
          for (const item of value) {
            if (!item || typeof item !== 'object') {
              continue;
            }
            for (const subKey of ref.keys) {
              add((item as Record<string, unknown>)[subKey]);
            }
          }
        }
        break;
    }
  }
  return ids;
}
