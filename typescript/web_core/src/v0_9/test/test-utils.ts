/*
 * Copyright 2024 Google LLC
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

import {ComponentContext} from '../../rendering/component-context.js';
import {SurfaceModel} from '../../state/surface-model.js';
import {Catalog, ComponentApi} from '../../catalog/types.js';
import {ComponentModel} from '../../state/component-model.js';

/**
 * Test double for `SurfaceModel` initialized with an empty catalog.
 */
export class TestSurfaceModel extends SurfaceModel<ComponentApi> {
  /**
   * Creates a new `TestSurfaceModel` instance.
   *
   * @param actionHandler Optional action listener callback.
   */
  constructor(actionHandler: any = async () => {}) {
    super('test', new Catalog('test-catalog', []), {});
    this.onAction.subscribe(actionHandler);
  }
}

/**
 * Creates a mock `ComponentContext` bound to a test surface and component model.
 *
 * @param properties Component properties dictionary.
 * @param actionHandler Optional action listener callback.
 * @returns Initialized component context for testing.
 */
export function createTestContext(properties: any, actionHandler: any = async () => {}) {
  const surface = new TestSurfaceModel(actionHandler);
  const component = new ComponentModel('test-id', 'TestComponent', properties, surface.catalog);
  surface.componentsModel.addComponent(component);

  const context = new ComponentContext(surface, 'test-id', '/');

  return context;
}
