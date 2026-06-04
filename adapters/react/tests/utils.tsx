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

import React from 'react';
import {render} from '@testing-library/react';
import {vi} from 'vitest';
import {SurfaceModel, ComponentModel, Catalog, ComponentContext} from '@a2ui/web_core/v0_9';
import {BASIC_FUNCTIONS} from '@a2ui/web_core/v0_9/basic_catalog';
import type {ReactComponentImplementation} from '../src/v0_9/adapter';

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
 * A robust test utility for rendering A2UI React components in isolation
 * while maintaining a real A2UI state lifecycle.
 */
export function renderA2uiComponent(
  impl: ReactComponentImplementation,
  componentId: string,
  initialProperties: Record<string, any>,
  options: RenderA2uiOptions = {},
) {
  const {
    initialData = {},
    additionalImpls = [],
    additionalComponents = [],
    functions = BASIC_FUNCTIONS,
  } = options;

  // Combine all implementations into the catalog
  const allImpls = [impl, ...additionalImpls];
  const catalog = new Catalog('test-catalog', allImpls, functions);
  const surface = new SurfaceModel<ReactComponentImplementation>('test-surface', catalog);

  // Setup data model
  surface.dataModel.set('/', initialData);

  // Add the component under test
  const mainModel = new ComponentModel(componentId, impl.name, initialProperties);
  surface.componentsModel.addComponent(mainModel);

  // Add any explicitly defined child component models
  for (const childModel of additionalComponents) {
    surface.componentsModel.addComponent(childModel);
  }

  const mainContext = new ComponentContext(surface, componentId, '/');

  // Smart buildChild mock:
  // 1. If the component exists in the model and catalog, render it for real.
  // 2. Otherwise, render a placeholder div that tests can query.
  const buildChild = vi.fn((id: string, basePath?: string) => {
    const compModel = surface.componentsModel.get(id);

    if (!compModel) {
      return <div key={`${id}-${basePath}`} data-testid={`child-${id}`} data-basepath={basePath} />;
    }

    const compImpl = surface.catalog.components.get(compModel.type);
    if (!compImpl) {
      return <div key={`${id}-${basePath}`} data-testid={`error-unknown-type-${compModel.type}`} />;
    }

    const ctx = new ComponentContext(surface, id, basePath || '/');
    const ChildComponent = (compImpl as ReactComponentImplementation).render;

    return <ChildComponent key={`${id}-${basePath}`} context={ctx} buildChild={buildChild} />;
  });

  const ComponentToRender = impl.render;

  const view = render(<ComponentToRender context={mainContext} buildChild={buildChild} />);

  return {
    view,
    surface,
    buildChild,
    mainModel,
    context: mainContext,
    // Helper to trigger data model updates and wait for re-render
    updateData: async (path: string, value: any) => {
      surface.dataModel.set(path, value);
      // Wait for React to process the useSyncExternalStore update
      await new Promise(resolve => setTimeout(resolve, 0));
    },
  };
}
