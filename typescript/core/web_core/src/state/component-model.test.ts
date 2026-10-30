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
import {Catalog} from '../catalog/types.js';
import {ComponentModel} from './component-model.js';

describe('ComponentModel', () => {
  let component: ComponentModel;
  const defaultCatalog = new Catalog('default', '1.0', []);

  beforeEach(() => {
    component = new ComponentModel('c1', 'Button', {label: 'Click Me'}, defaultCatalog);
  });

  it('initializes properties', () => {
    assert.strictEqual(component.id, 'c1');
    assert.strictEqual(component.type, 'Button');
    assert.strictEqual(component.properties.label, 'Click Me');
  });

  it('constructs without a catalog for pre-1.0 callers', () => {
    const legacy = new ComponentModel('c2', 'Text', {text: 'Hi'});
    assert.strictEqual(legacy.catalog, undefined);
    assert.strictEqual(legacy.properties.text, 'Hi');
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
      component: 'Button',
      label: 'Click Me',
    });
  });

  it('keeps a property named type apart from the component type in the tree', () => {
    const chart = new ComponentModel(
      'chart1',
      'Chart',
      {type: 'pie', title: 'Sales'},
      defaultCatalog,
    );
    assert.deepStrictEqual(chart.componentTree, {
      id: 'chart1',
      component: 'Chart',
      type: 'pie',
      title: 'Sales',
    });
  });

  it('keeps the component metadata over a property named metadata in the tree', () => {
    const chart = new ComponentModel(
      'chart1',
      'Chart',
      {metadata: 'prop', title: 'Sales'},
      defaultCatalog,
      {extensions: {owner: 'agent'}},
    );
    assert.deepStrictEqual(chart.componentTree, {
      id: 'chart1',
      component: 'Chart',
      metadata: {extensions: {owner: 'agent'}},
      title: 'Sales',
    });
  });

  it('stores and exposes a Catalog reference', () => {
    assert.strictEqual(component.catalog, defaultCatalog);
    assert.strictEqual(component.catalog.id, 'default');

    const testCatalog = new Catalog('custom-cat', '1.0', []);
    const customComp = new ComponentModel('c2', 'Card', {title: 'Hello'}, testCatalog);
    assert.strictEqual(customComp.catalog, testCatalog);
    assert.strictEqual(customComp.catalog.id, 'custom-cat');
  });

  it('manages metadata, extensions, reactivity, and disposal', async () => {
    const emissions: Array<Record<string, unknown> | undefined> = [];
    let updatedCalls = 0;
    component.onMetadataChanged.subscribe(meta => {
      emissions.push(meta);
    });
    component.onUpdated.subscribe(() => {
      updatedCalls++;
    });

    component.setExtension('annot', {priority: 1});
    assert.deepStrictEqual(component.metadata, {extensions: {annot: {priority: 1}}});
    assert.deepStrictEqual(component.extensions, {annot: {priority: 1}});

    // setExtension with null stores explicit null
    component.setExtension('empty_ext', null);
    assert.deepStrictEqual(component.extensions, {annot: {priority: 1}, empty_ext: null});

    // removeExtension removes keys and clears metadata when empty
    component.removeExtension('empty_ext');
    component.removeExtension('annot');
    assert.strictEqual(component.metadata, undefined);
    assert.strictEqual(component.extensions, undefined);

    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(emissions.length, 4);
    assert.strictEqual(updatedCalls, 0);

    assert.throws(
      () => component.setExtension('bad-key', true),
      /Invalid UAX #31 extension identifier: "bad-key"/,
    );
    assert.throws(() => {
      component.metadata = {unknownKey: 1} as any;
    }, /Unexpected property "unknownKey" in metadata/);

    // __proto__ extension key is defined as an own property without mutating prototype
    const protoMeta = JSON.parse('{"extensions": {"__proto__": {"tag": "safe"}}}');
    component.metadata = protoMeta;
    assert.strictEqual(Object.getPrototypeOf(component.extensions), Object.prototype);
    assert.deepStrictEqual(Object.keys(component.extensions!), ['__proto__']);

    // Empty envelopes normalize to undefined
    component.metadata = {};
    assert.strictEqual(component.metadata, undefined);
    component.metadata = {extensions: {}};
    assert.strictEqual(component.metadata, undefined);

    // applyUpdate updates both properties and metadata before emitting
    const observedDuringUpdate: Array<{props: Record<string, any>; meta: unknown}> = [];
    component.onUpdated.subscribe(c => {
      observedDuringUpdate.push({props: c.properties, meta: c.metadata});
    });
    component.applyUpdate({text: 'Atomic'}, {extensions: {step: 2}});
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(observedDuringUpdate.length, 1);
    assert.deepStrictEqual(observedDuringUpdate[0], {
      props: {text: 'Atomic'},
      meta: {extensions: {step: 2}},
    });

    component.dispose();
    const countBefore = emissions.length;
    component.metadata = {extensions: {after_dispose: true}};
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(emissions.length, countBefore);
  });
});
