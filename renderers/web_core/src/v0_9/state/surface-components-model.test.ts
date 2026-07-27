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
import {SurfaceComponentsModel} from './surface-components-model.js';
import {ComponentModel} from './component-model.js';

describe('SurfaceComponentsModel', () => {
  let model: SurfaceComponentsModel;

  beforeEach(() => {
    model = new SurfaceComponentsModel();
  });

  it('starts empty', () => {
    assert.strictEqual(model.get('any'), undefined);
  });

  it('adds a new component', () => {
    const c1 = new ComponentModel('c1', 'Button', {label: 'Click'});
    model.addComponent(c1);
    const retrieved = model.get('c1');
    assert.ok(retrieved);
    assert.strictEqual(retrieved?.id, 'c1');
    assert.strictEqual(retrieved?.type, 'Button');
    assert.strictEqual(retrieved?.properties.label, 'Click');
  });

  it('updates an existing component', () => {
    const c1 = new ComponentModel('c1', 'Button', {label: 'Initial'});
    model.addComponent(c1);

    // Track update on component itself
    let updateCount = 0;
    c1.onUpdated.subscribe(() => {
      updateCount++;
    });

    c1.properties = {label: 'Updated'};

    assert.strictEqual(c1.properties.label, 'Updated');
    assert.strictEqual(updateCount, 1);
  });

  it('notifies on component creation', () => {
    let createdComponent: ComponentModel | undefined;
    model.onCreated.subscribe(c => {
      createdComponent = c;
    });

    model.addComponent(new ComponentModel('c1', 'Button', {}));
    assert.ok(createdComponent);
    assert.strictEqual(createdComponent?.id, 'c1');
  });

  it('throws when adding duplicate component', () => {
    const c1 = new ComponentModel('c1', 'Button', {});
    model.addComponent(c1);
    assert.throws(() => {
      model.addComponent(new ComponentModel('c1', 'Button', {}));
    }, /already exists/);
  });

  it('returns entries iterator', () => {
    const c1 = new ComponentModel('c1', 'Button', {});
    const c2 = new ComponentModel('c2', 'Text', {});
    model.addComponent(c1);
    model.addComponent(c2);

    const entries = Array.from(model.entries);
    assert.strictEqual(entries.length, 2);
    assert.deepStrictEqual(entries[0], ['c1', c1]);
    assert.deepStrictEqual(entries[1], ['c2', c2]);
  });

  it('disposes components during model dispose', () => {
    const c1 = new ComponentModel('c1', 'Button', {});
    model.addComponent(c1);

    let childDisposed = false;
    c1.dispose = () => {
      childDisposed = true;
    };

    model.dispose();

    assert.strictEqual(childDisposed, true);
    assert.strictEqual((model as any).components.size, 0);
  });

  it('safely attempts to remove non-existent component', () => {
    // Should not throw
    model.removeComponent('does-not-exist');
  });
});
