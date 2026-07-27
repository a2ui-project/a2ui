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
import {ComponentModel} from './component-model.js';

describe('ComponentModel', () => {
  let component: ComponentModel;

  beforeEach(() => {
    component = new ComponentModel('c1', 'Button', {label: 'Click Me'});
  });

  it('initializes properties', () => {
    assert.strictEqual(component.id, 'c1');
    assert.strictEqual(component.type, 'Button');
    assert.strictEqual(component.properties.label, 'Click Me');
  });

  it('updates properties', () => {
    component.properties = {label: 'Clicked'};
    assert.strictEqual(component.properties.label, 'Clicked');
  });

  it('notifies listeners on update', () => {
    let updatedComponent: ComponentModel | undefined;

    component.onUpdated.subscribe((c: ComponentModel) => {
      updatedComponent = c;
    });

    component.properties = {label: 'New'};

    assert.strictEqual(updatedComponent, component);
    assert.strictEqual(updatedComponent?.properties.label, 'New');
  });

  it('unsubscribes listeners', () => {
    let callCount = 0;

    const sub = component.onUpdated.subscribe(() => {
      callCount++;
    });

    component.properties = {label: '1'};
    assert.strictEqual(callCount, 1);

    sub.unsubscribe();
    component.properties = {label: '2'};
    assert.strictEqual(callCount, 1);
  });

  it('returns component tree representation', () => {
    const tree = component.componentTree;
    assert.deepStrictEqual(tree, {
      id: 'c1',
      type: 'Button',
      label: 'Click Me',
    });
  });
});
