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
import {z} from 'zod';
import {Catalog} from '../catalog/types.js';
import {SurfaceComponentsModel} from './surface-components-model.js';
import {ComponentModel} from './component-model.js';

describe('SurfaceComponentsModel', () => {
  let model: SurfaceComponentsModel;
  const defaultCatalog = new Catalog('default', []);

  beforeEach(() => {
    model = new SurfaceComponentsModel();
  });

  it('starts empty', () => {
    assert.strictEqual(model.get('any'), undefined);
  });

  it('adds a new component', () => {
    const c1 = new ComponentModel('c1', 'Button', {label: 'Click'}, defaultCatalog);
    model.addComponent(c1);
    const retrieved = model.get('c1');
    assert.ok(retrieved);
    assert.strictEqual(retrieved?.id, 'c1');
    assert.strictEqual(retrieved?.type, 'Button');
    assert.strictEqual(retrieved?.properties.label, 'Click');
  });

  it('updates an existing component', () => {
    const c1 = new ComponentModel('c1', 'Button', {label: 'Initial'}, defaultCatalog);
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

    model.addComponent(new ComponentModel('c1', 'Button', {}, defaultCatalog));
    assert.ok(createdComponent);
    assert.strictEqual(createdComponent?.id, 'c1');
  });

  it('throws when adding duplicate component', () => {
    const c1 = new ComponentModel('c1', 'Button', {}, defaultCatalog);
    model.addComponent(c1);
    assert.throws(() => {
      model.addComponent(new ComponentModel('c1', 'Button', {}, defaultCatalog));
    }, /already exists/);
  });

  it('returns entries iterator', () => {
    const c1 = new ComponentModel('c1', 'Button', {}, defaultCatalog);
    const c2 = new ComponentModel('c2', 'Text', {}, defaultCatalog);
    model.addComponent(c1);
    model.addComponent(c2);

    const entries = Array.from(model.entries);
    assert.strictEqual(entries.length, 2);
    assert.deepStrictEqual(entries[0], ['c1', c1]);
    assert.deepStrictEqual(entries[1], ['c2', c2]);
  });

  it('exposes componentsMap property', () => {
    const c1 = new ComponentModel('c1', 'Button', {}, defaultCatalog);
    model.addComponent(c1);
    assert.strictEqual(model.componentsMap.get('c1'), c1);
    assert.strictEqual(model.componentsMap.size, 1);
  });

  it('disposes components during model dispose', () => {
    const c1 = new ComponentModel('c1', 'Button', {}, defaultCatalog);
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

  describe('inlined topology & cycle detection', () => {
    let testCatalog: Catalog<any>;

    beforeEach(() => {
      const boxApi = {
        name: 'Box',
        schema: z.object({
          child: z.string().describe('ChildComponentId').optional(),
        }),
      };
      const containerApi = {
        name: 'Container',
        schema: z.object({
          singleChild: z.string().describe('ChildComponentId'),
          childrenList: z.array(z.string()).describe('ChildList'),
          dynamicChild: z
            .union([z.array(z.string()), z.object({componentId: z.string(), path: z.string()})])
            .describe('ChildList'),
        }),
      };
      const textApi = {
        name: 'Text',
        schema: z.object({text: z.string()}),
      };
      testCatalog = new Catalog('test-cat', [boxApi, containerApi, textApi]);
      model.setCatalog(testCatalog);
    });

    it('extracts child references using schema-driven inspection', () => {
      const root = new ComponentModel(
        'root',
        'Container',
        {
          singleChild: 'c1',
          childrenList: ['c2', 'c3'],
          dynamicChild: {componentId: 'c4', path: '/items'},
        },
        testCatalog,
      );
      model.addComponent(root);

      const childIds = model.getChildIds('root');
      assert.ok(childIds.includes('c1'));
      assert.ok(childIds.includes('c2'));
      assert.ok(childIds.includes('c3'));
      assert.ok(childIds.includes('c4'));
    });

    it('detects immediate self-reference', () => {
      const root = new ComponentModel('root', 'Box', {child: 'root'}, testCatalog);
      model.addComponent(root);

      assert.throws(
        () => model.detectCycles(),
        (err: any) =>
          err.name === 'A2uiRecursionError' &&
          err.message.includes("Component 'root' references itself"),
      );
    });

    it('detects circular reference in component hierarchy', () => {
      const root = new ComponentModel('root', 'Box', {child: 'c1'}, testCatalog);
      const c1 = new ComponentModel('c1', 'Box', {child: 'c2'}, testCatalog);
      const c2 = new ComponentModel('c2', 'Box', {child: 'root'}, testCatalog);
      model.addComponent(root);
      model.addComponent(c1);
      model.addComponent(c2);

      assert.throws(
        () => model.detectCycles(),
        (err: any) =>
          err.name === 'A2uiRecursionError' && err.message.includes('Circular reference detected'),
      );
    });

    it('detects recursion depth limit exceeded', () => {
      // Build a chain of 52 components
      model.addComponent(new ComponentModel('root', 'Box', {child: 'node_1'}, testCatalog));
      for (let i = 1; i <= 52; i++) {
        const nextId = i === 52 ? undefined : `node_${i + 1}`;
        model.addComponent(new ComponentModel(`node_${i}`, 'Box', {child: nextId}, testCatalog));
      }

      assert.throws(
        () => model.detectCycles(),
        (err: any) =>
          err.name === 'A2uiRecursionError' &&
          err.message.includes('Global recursion limit exceeded'),
      );
    });

    it('validates surface topology and detects missing root', () => {
      model.addComponent(new ComponentModel('leaf', 'Text', {text: 'hi'}, testCatalog));

      assert.throws(
        () => model.validateTopology({allowMissingRoot: false}),
        (err: any) =>
          err.name === 'A2uiIntegrityError' && err.message.includes('Missing root component'),
      );

      assert.doesNotThrow(() => model.validateTopology({allowMissingRoot: true}));
    });

    it('validates surface topology and detects dangling references', () => {
      model.addComponent(new ComponentModel('root', 'Box', {child: 'missing_child'}, testCatalog));

      assert.throws(
        () => model.validateTopology({allowDanglingReferences: false}),
        (err: any) =>
          err.name === 'A2uiIntegrityError' &&
          err.message.includes("Dangling reference 'missing_child'"),
      );

      assert.doesNotThrow(() =>
        model.validateTopology({allowDanglingReferences: true, allowOrphanComponents: true}),
      );
    });

    it('validates surface topology and detects orphan components', () => {
      model.addComponent(new ComponentModel('root', 'Box', {child: 'c1'}, testCatalog));
      model.addComponent(new ComponentModel('c1', 'Text', {text: 'hi'}, testCatalog));
      model.addComponent(new ComponentModel('orphan', 'Text', {text: 'unused'}, testCatalog));

      assert.throws(
        () => model.validateTopology({allowOrphanComponents: false}),
        (err: any) =>
          err.name === 'A2uiIntegrityError' && err.message.includes("is not reachable from 'root'"),
      );

      assert.doesNotThrow(() => model.validateTopology({allowOrphanComponents: true}));
    });

    it('returns validation errors list via validateReferences without throwing', () => {
      model.addComponent(new ComponentModel('orphan', 'Text', {text: 'unused'}, testCatalog));

      const errors = model.validateReferences({allowMissingRoot: false});
      assert.strictEqual(errors.length, 1);
      assert.ok(errors[0].message.includes('Missing root component'));
    });

    it('extracts references and validates topology across mixed catalogs', () => {
      const customCatalog = new Catalog('custom-cat', [
        {
          name: 'CustomCard',
          schema: z.object({
            bodySlot: z.string().describe('ChildComponentId'),
            footerSlot: z.string().describe('ChildComponentId').optional(),
          }),
        },
        {
          name: 'CustomChart',
          schema: z.object({title: z.string()}),
        },
      ]);

      // root uses customCatalog ('CustomCard' with bodySlot pointing to 'c1' and footerSlot pointing to 'c2')
      const root = new ComponentModel(
        'root',
        'CustomCard',
        {bodySlot: 'c1', footerSlot: 'c2'},
        customCatalog,
      );
      // c1 is a standard Box from testCatalog pointing to c3 (CustomChart)
      const c1 = new ComponentModel('c1', 'Box', {child: 'c3'}, testCatalog);
      // c2 is a standard Text from testCatalog
      const c2 = new ComponentModel('c2', 'Text', {text: 'Footer'}, testCatalog);
      // c3 is a CustomChart from customCatalog
      const c3 = new ComponentModel('c3', 'CustomChart', {title: 'Sales'}, customCatalog);

      model.addComponent(root);
      model.addComponent(c1);
      model.addComponent(c2);
      model.addComponent(c3);

      const rootRefs = model.getChildIds('root');
      assert.ok(rootRefs.includes('c1'));
      assert.ok(rootRefs.includes('c2'));

      const c1Refs = model.getChildIds('c1');
      assert.ok(c1Refs.includes('c3'));

      // Topology validation should pass with zero errors
      assert.doesNotThrow(() => model.validateTopology({allowOrphanComponents: false}));
    });

    it('detects cycles between components from different catalogs', () => {
      const customCatalog = new Catalog('custom-cat', [
        {
          name: 'CustomContainer',
          schema: z.object({
            contentId: z.string().describe('ChildComponentId'),
          }),
        },
      ]);

      // root (CustomContainer from customCatalog) -> c1 (Box from testCatalog) -> root (cycle!)
      const root = new ComponentModel('root', 'CustomContainer', {contentId: 'c1'}, customCatalog);
      const c1 = new ComponentModel('c1', 'Box', {child: 'root'}, testCatalog);

      model.addComponent(root);
      model.addComponent(c1);

      assert.throws(
        () => model.detectCycles(),
        (err: any) =>
          err.name === 'A2uiRecursionError' && err.message.includes('Circular reference detected'),
      );
    });

    it('respects maxDepth configured via ValidationConfig in validateTopology', () => {
      // Chain of 5 components: root -> c1 -> c2 -> c3 -> c4
      model.addComponent(new ComponentModel('root', 'Box', {child: 'c1'}, testCatalog));
      model.addComponent(new ComponentModel('c1', 'Box', {child: 'c2'}, testCatalog));
      model.addComponent(new ComponentModel('c2', 'Box', {child: 'c3'}, testCatalog));
      model.addComponent(new ComponentModel('c3', 'Box', {child: 'c4'}, testCatalog));
      model.addComponent(new ComponentModel('c4', 'Text', {text: 'end'}, testCatalog));

      // Max depth 3 should fail
      assert.throws(
        () => model.validateTopology({maxDepth: 3}),
        (err: any) =>
          err.name === 'A2uiRecursionError' &&
          err.message.includes('Global recursion limit exceeded'),
      );

      // Max depth 10 should pass
      assert.doesNotThrow(() => model.validateTopology({maxDepth: 10}));
    });
  });
});
