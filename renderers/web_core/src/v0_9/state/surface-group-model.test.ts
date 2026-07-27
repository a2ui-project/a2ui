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
import {SurfaceGroupModel} from './surface-group-model.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
import {SurfaceModel} from './surface-model.js';

describe('SurfaceGroupModel', () => {
  let model: SurfaceGroupModel<ComponentApi>;
  let catalog: Catalog<ComponentApi>;

  beforeEach(() => {
    model = new SurfaceGroupModel<ComponentApi>();
    catalog = new Catalog('test-catalog', []);
  });

  it('adds surface', () => {
    const surface = new SurfaceModel('s1', catalog, {});
    model.addSurface(surface);
    assert.ok(model.getSurface('s1'));
    assert.strictEqual(model.getSurface('s1'), surface);
  });

  it('ignores duplicate surface addition', () => {
    const s1 = new SurfaceModel('s1', catalog, {});
    const s2 = new SurfaceModel('s1', catalog, {}); // Same ID
    model.addSurface(s1);
    model.addSurface(s2);
    assert.strictEqual(model.getSurface('s1'), s1); // Should still be the first one
  });

  it('deletes surface', () => {
    const surface = new SurfaceModel('s1', catalog, {});
    model.addSurface(surface);
    assert.ok(model.getSurface('s1'));

    model.deleteSurface('s1');
    assert.strictEqual(model.getSurface('s1'), undefined);
  });

  it('notifies lifecycle listeners', () => {
    let created: SurfaceModel<ComponentApi> | undefined;
    let deletedId: string | undefined;

    model.onSurfaceCreated.subscribe(s => {
      created = s;
    });
    model.onSurfaceDeleted.subscribe(id => {
      deletedId = id;
    });

    const surface = new SurfaceModel('s1', catalog, {});
    model.addSurface(surface);
    assert.ok(created);
    assert.strictEqual(created?.id, 's1');

    model.deleteSurface('s1');
    assert.strictEqual(deletedId, 's1');
  });

  it('propagates actions from surfaces', async () => {
    let receivedAction: any;
    model.onAction.subscribe(action => {
      receivedAction = action;
    });

    const surface = new SurfaceModel('s1', catalog, {});
    model.addSurface(surface);

    await surface.dispatchAction({event: {name: 'test'}}, 'c1');
    assert.strictEqual(receivedAction.name, 'test');
    assert.strictEqual(receivedAction.surfaceId, 's1');
    assert.strictEqual(receivedAction.sourceComponentId, 'c1');
  });

  it('stops propagating actions after deletion', async () => {
    let callCount = 0;
    model.onAction.subscribe(() => {
      callCount++;
    });

    const surface = new SurfaceModel('s1', catalog, {});
    model.addSurface(surface);
    model.deleteSurface('s1');

    await surface.dispatchAction({event: {name: 'test'}}, 'c1');
    assert.strictEqual(callCount, 0);
  });

  it('exposes surfacesMap', () => {
    const surface = new SurfaceModel('s1', catalog, {});
    model.addSurface(surface);
    const map = model.surfacesMap;
    assert.strictEqual(map.size, 1);
    assert.strictEqual(map.get('s1'), surface);
  });

  it('disposes correctly', () => {
    const s1 = new SurfaceModel('s1', catalog, {});
    const s2 = new SurfaceModel('s2', catalog, {});
    model.addSurface(s1);
    model.addSurface(s2);

    let deletedCount = 0;
    model.onSurfaceDeleted.subscribe(() => {
      deletedCount++;
    });

    model.dispose();

    assert.strictEqual(deletedCount, 2);
    assert.strictEqual(model.surfacesMap.size, 0);
  });
});
