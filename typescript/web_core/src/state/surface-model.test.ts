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

import * as assert from 'node:assert';
import {describe, it, beforeEach} from 'node:test';
import {SurfaceModel} from './surface-model.js';
import {DataModel} from './data-model.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
import {ComponentModel} from './component-model.js';
import {ComponentContext} from '../resolution/component-context.js';

describe('SurfaceModel', () => {
  let surface: SurfaceModel<ComponentApi>;
  let catalog: Catalog<ComponentApi>;
  let actions: any[] = [];
  let errors: any[] = [];

  beforeEach(() => {
    actions = [];
    errors = [];
    catalog = new Catalog('test-catalog', '1.0', []);
    surface = new SurfaceModel<ComponentApi>('surface-1', catalog, new Map(), {});
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

  it('accepts custom data model in constructor', () => {
    const customData = new DataModel({custom: 'data'});
    const customSurface = new SurfaceModel('surface-2', catalog, new Map(), {}, false, customData);
    assert.strictEqual(customSurface.dataModel, customData);
    assert.strictEqual(customSurface.dataModel.get('/custom'), 'data');
  });

  it('exposes components model', () => {
    surface.componentsModel.addComponent(
      new ComponentModel('c1', 'Button', {}, surface.defaultCatalog),
    );
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

  it('exposes the default catalog through the deprecated catalog alias', () => {
    assert.strictEqual(surface.defaultCatalog, catalog);
    assert.strictEqual(surface.catalog, catalog);
  });

  it('seeds defaultCatalog into availableCatalogs when none are supplied', () => {
    assert.strictEqual(surface.availableCatalogs.size, 1);
    assert.strictEqual(surface.availableCatalogs.get(catalog.id), catalog);
  });

  it('exposes the catalogs it was constructed with', () => {
    const other = new Catalog<ComponentApi>('other-catalog', '1.0', []);
    const multi = new SurfaceModel<ComponentApi>(
      'surface-multi',
      catalog,
      new Map([
        [catalog.id, catalog],
        [other.id, other],
      ]),
    );
    assert.strictEqual(multi.availableCatalogs.get('other-catalog'), other);
    assert.strictEqual(multi.availableCatalogs.get('test-catalog'), catalog);
  });

  it('carries an explicit catalogId into the dispatched action', async () => {
    await surface.dispatchAction(
      {functionCall: {call: 'submit', args: {}, catalogId: 'other-catalog'}},
      'comp-1',
    );
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].catalogId, 'other-catalog');
  });

  it('omits catalogId when the payload does not name a catalog', async () => {
    await surface.dispatchAction({event: {name: 'click'}}, 'comp-1');
    assert.strictEqual(actions.length, 1);
    assert.ok(!('catalogId' in actions[0]));
  });

  it('dispatches functionCall actions with call and args', async () => {
    await surface.dispatchAction({functionCall: {call: 'doTask', args: {param: 123}}}, 'comp-2');
    assert.strictEqual(actions.length, 1);
    const action = actions[0];
    assert.strictEqual(action.name, 'doTask');
    assert.strictEqual(action.surfaceId, 'surface-1');
    assert.strictEqual(action.sourceComponentId, 'comp-2');
    assert.deepStrictEqual(action.context, {param: 123});
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
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'Box', {}, surface.defaultCatalog),
    );
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

  it('ignores invalid or missing action payloads gracefully', async () => {
    await surface.dispatchAction(null, 'c1');
    await surface.dispatchAction(undefined, 'c1');
    await surface.dispatchAction({}, 'c1');
    await surface.dispatchAction({foo: 'bar'}, 'c1');
    await surface.dispatchAction({event: {}}, 'c1');
    await surface.dispatchAction({event: {name: 123}}, 'c1');
    assert.strictEqual(actions.length, 0);
  });

  it('automatically seeds defaultCatalog into availableCatalogs when omitted', () => {
    const standaloneSurface = new SurfaceModel('s-standalone', catalog);
    assert.strictEqual(standaloneSurface.availableCatalogs.get(catalog.id), catalog);
  });

  it('preserves non-empty string userMessage on emitted ActionPayload and ignores empty or non-string userMessage', async () => {
    await surface.dispatchAction(
      {event: {name: 'submit', userMessage: 'Submitted form', context: {ok: true}}},
      'btn-1',
    );
    await surface.dispatchAction({event: {name: 'emptyMsg', userMessage: ''}}, 'btn-empty');
    await surface.dispatchAction({event: {name: 'numericMsg', userMessage: 42}}, 'btn-2');
    await surface.dispatchAction({event: {name: 'objMsg', userMessage: {nested: 'bad'}}}, 'btn-3');
    assert.strictEqual(actions.length, 4);
    assert.strictEqual(actions[0].userMessage, 'Submitted form');
    assert.strictEqual(actions[1].userMessage, undefined);
    assert.strictEqual(actions[2].userMessage, undefined);
    assert.strictEqual(actions[3].userMessage, undefined);
  });

  it('throws TypeError if 3rd argument is not a Map or undefined/null', () => {
    assert.throws(() => new SurfaceModel('surface-err', catalog, {primaryColor: 'red'} as any), {
      name: 'TypeError',
      message: /availableCatalogs.*3rd argument.*theme.*4th argument/i,
    });
    assert.throws(() => new SurfaceModel('surface-err', catalog, [catalog] as any), {
      name: 'TypeError',
      message: /availableCatalogs.*3rd argument.*theme.*4th argument/i,
    });
  });

  it('accepts a Map or undefined/null for availableCatalogs in constructor', () => {
    const other = new Catalog<ComponentApi>('other-catalog', '1.0', []);
    const surfaceWithMap = new SurfaceModel('s-map', catalog, new Map([['other-catalog', other]]));
    assert.strictEqual(surfaceWithMap.availableCatalogs.get('other-catalog'), other);

    const surfaceWithNull = new SurfaceModel('s-null', catalog, null);
    assert.strictEqual(surfaceWithNull.availableCatalogs.get(catalog.id), catalog);

    const surfaceWithUndefined = new SurfaceModel('s-undef', catalog, undefined);
    assert.strictEqual(surfaceWithUndefined.availableCatalogs.get(catalog.id), catalog);
  });
});
