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

import assert from 'node:assert';
import {describe, it, beforeEach} from 'node:test';
import {SurfaceModel} from './surface-model.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
import {ComponentModel} from './component-model.js';
import {ComponentContext} from '../rendering/component-context.js';

describe('SurfaceModel', () => {
  let surface: SurfaceModel<ComponentApi>;
  let catalog: Catalog<ComponentApi>;
  let actions: any[] = [];
  let errors: any[] = [];

  beforeEach(() => {
    actions = [];
    errors = [];
    catalog = new Catalog('test-catalog', []);
    surface = new SurfaceModel<ComponentApi>('surface-1', catalog, {});
    surface.onAction.subscribe(async action => {
      actions.push(action);
    });
    surface.onError.subscribe(async error => {
      errors.push(error);
    });
  });

  it('initializes with empty data model', () => {
    assert.deepStrictEqual(surface.dataModel.get('/'), {});
  });

  it('exposes components model', () => {
    surface.componentsModel.addComponent(new ComponentModel('c1', 'Button', {}));
    assert.ok(surface.componentsModel.get('c1'));
  });

  it('dispatches actions with metadata', async () => {
    await surface.dispatchAction({event: {name: 'click', context: {foo: 'bar'}}}, 'comp-1');
    assert.strictEqual(actions.length, 1);
    const action = actions[0];
    assert.strictEqual(action.name, 'click');
    assert.strictEqual(action.surfaceId, 'surface-1');
    assert.strictEqual(action.sourceComponentId, 'comp-1');
    assert.deepStrictEqual(action.context, {foo: 'bar'});
    assert.ok(action.timestamp);
    assert.doesNotThrow(() => new Date(action.timestamp));
  });

  it('dispatches actions with default context', async () => {
    await surface.dispatchAction({event: {name: 'click'}}, 'comp-1');
    assert.strictEqual(actions.length, 1);
    assert.deepStrictEqual(actions[0].context, {});
  });

  it('dispatches errors', async () => {
    await surface.dispatchError({
      code: 'TEST_ERROR',
      message: 'Something failed',
    });
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'TEST_ERROR');
    assert.strictEqual(errors[0].message, 'Something failed');
    assert.strictEqual(errors[0].surfaceId, 'surface-1');
  });

  it('creates a component context', () => {
    surface.componentsModel.addComponent(new ComponentModel('root', 'Box', {}));
    const ctx = new ComponentContext(surface, 'root', '/mydata');
    assert.ok(ctx);
    assert.strictEqual(ctx.dataContext.path, '/mydata');
  });

  it('disposes resources', () => {
    // Verify that the dispose method clears subscriptions and internal state.
    // Ideally, we would need to mock dependencies to verify deep disposal,
    // but here we ensure that the surface's own emitters are cleared.

    let actionReceived = false;
    surface.onAction.subscribe(() => {
      actionReceived = true;
    });

    surface.dispose();

    // After dispose, no more actions should be emitted.
    // The EventEmitter.dispose method clears all listeners.
    surface.dispatchAction({event: {name: 'click'}}, 'c1');
    assert.strictEqual(actionReceived, false, 'Should not receive actions after dispose');
  });
});
