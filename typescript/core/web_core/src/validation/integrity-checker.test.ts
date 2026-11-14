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

/**
 * @fileoverview Unit tests for component integrity checking and path syntax recursion validation.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import * as z from 'zod/v4';

import {buildComponentRefMap, ComponentRefMap} from '../catalog/reference-map.js';
import {Catalog} from '../catalog/types.js';
import {BASIC_COMPONENTS} from '../catalogs/basic/v1/components/basic_components.js';
import {A2uiIntegrityError, A2uiRecursionError} from '../errors.js';
import {ComponentModel} from '../state/component-model.js';
import {SurfaceComponentsModel} from '../state/surface-components-model.js';
import {V10_CHILD_REF_OPTIONS} from '../v1_0/standard_defs.js';
import {getComponentReferences} from './integrity-checker.js';

describe('Integrity Verification', () => {
  describe('getComponentReferences', () => {
    it('extracts references from container components', () => {
      const refMap: ComponentRefMap = {
        Container: {
          singleRefs: new Set(['singleChild', 'nestedObj']),
          listRefs: new Set(['childrenList', 'tabs']),
        },
      };

      const comp = {
        id: 'c1',
        component: {
          Container: {
            singleChild: 'child1',
            childrenList: ['child2', 'child3'],
            nestedObj: {componentId: 'child4'},
            tabs: [{child: 'tab1'}, {child: 'tab2'}],
          },
        },
      };

      const refs = Array.from(getComponentReferences(comp, refMap));
      const refIds = refs.map(([id]) => id);

      assert.ok(refIds.includes('child1'));
      assert.ok(refIds.includes('child2'));
      assert.ok(refIds.includes('child3'));
      assert.ok(refIds.includes('child4'));
      assert.ok(refIds.includes('tab1'));
      assert.ok(refIds.includes('tab2'));
    });

    it('ignores sibling properties of a structured array item', () => {
      const refMap: ComponentRefMap = {
        Container: {
          singleRefs: new Set<string>(),
          listRefs: new Set(['tabs']),
          nestedRefs: {tabs: new Set(['child'])},
        },
      };

      const comp = {
        id: 'c1',
        component: {
          Container: {
            tabs: [
              {title: 'Overview', child: 'tab1'},
              {title: 'Details', child: 'tab2'},
            ],
          },
        },
      };

      const refs = Array.from(getComponentReferences(comp, refMap));

      assert.deepEqual(refs, [
        ['tab1', 'tabs[0].child'],
        ['tab2', 'tabs[1].child'],
      ]);
    });

    it('treats only the declared sub-key of the shipped Tabs schema as a reference', () => {
      const refMap = buildComponentRefMap(BASIC_COMPONENTS, V10_CHILD_REF_OPTIONS);

      assert.deepEqual(refMap['Tabs'].nestedRefs, {tabs: new Set(['child'])});

      const comp = {
        id: 'c1',
        component: {
          Tabs: {
            tabs: [{title: 'Overview', child: 'c2'}],
          },
        },
      };

      const refIds = Array.from(getComponentReferences(comp, refMap)).map(([id]) => id);

      assert.deepEqual(refIds, ['c2']);
    });

    it('falls back to a full sweep when the schema declared no nested keys', () => {
      const refMap: ComponentRefMap = {
        Container: {
          singleRefs: new Set<string>(),
          listRefs: new Set(['items']),
        },
      };

      const comp = {
        id: 'c1',
        component: {Container: {items: [{child: 'a', other: 'b'}]}},
      };

      const refIds = Array.from(getComponentReferences(comp, refMap)).map(([id]) => id);

      assert.deepEqual(refIds, ['a', 'b']);
    });

    it('extracts child list arrays from structured array items matching nestedKeys', () => {
      const refMap: ComponentRefMap = {
        Accordion: {
          singleRefs: new Set<string>(),
          listRefs: new Set(['sections']),
          nestedRefs: {sections: new Set(['children'])},
        },
      };

      const comp = {
        id: 'c1',
        component: {
          Accordion: {
            sections: [
              {title: 'Section 1', children: ['c2', 'c3']},
              {title: 'Section 2', children: ['c4']},
            ],
          },
        },
      };

      const refs = Array.from(getComponentReferences(comp, refMap));
      assert.deepEqual(refs, [
        ['c2', 'sections[0].children[0]'],
        ['c3', 'sections[0].children[1]'],
        ['c4', 'sections[1].children[0]'],
      ]);
    });

    it('prioritizes nestedKeys over template detection when structured array items also carry componentId and path/@path fields', () => {
      const refMap: ComponentRefMap = {
        ActionRows: {
          singleRefs: new Set<string>(),
          listRefs: new Set(['rows']),
          nestedRefs: {rows: new Set(['iconChild', 'children'])},
        },
      };

      const v09Comp = {
        id: 'root',
        component: {
          ActionRows: {
            rows: [
              {
                componentId: 'not-a-template-id',
                path: '/route/settings',
                iconChild: 'icon-1',
                children: ['body-1', 'body-2'],
              },
            ],
          },
        },
      };
      assert.deepEqual(Array.from(getComponentReferences(v09Comp, refMap)), [
        ['icon-1', 'rows[0].iconChild'],
        ['body-1', 'rows[0].children[0]'],
        ['body-2', 'rows[0].children[1]'],
      ]);

      const v10Comp = {
        id: 'root',
        component: 'ActionRows',
        rows: [
          {
            componentId: 'not-a-template-id',
            '@path': '/route/profile',
            iconChild: 'icon-2',
            children: ['body-3'],
          },
        ],
      };
      assert.deepEqual(Array.from(getComponentReferences(v10Comp, refMap)), [
        ['icon-2', 'rows[0].iconChild'],
        ['body-3', 'rows[0].children[0]'],
      ]);

      // When an item omits optional nested child keys (`iconChild`, `children`), its own
      // `componentId` and `path`/`@path` fields must not be mistaken for a template.
      const omittedOptionalChildRow = {
        id: 'root',
        component: 'ActionRows',
        rows: [
          {
            componentId: 'not-a-template-id',
            path: '/route/settings',
          },
          {
            componentId: 'also-not-a-template-id',
            '@path': '/route/profile',
          },
        ],
      };
      assert.deepEqual(Array.from(getComponentReferences(omittedOptionalChildRow, refMap)), []);

      // When an open container's `child` holds a data-binding or function-call object without
      // `componentId`, no string inside the binding expression is treated as a child component ID.
      const openCatalog = new Catalog('open-binding-cat', '1.0', [
        {name: 'OpenBox', schema: z.object({}).passthrough()},
      ]);
      for (const boundChild of [
        {'@path': '/someData'},
        {path: '/someData'},
        {'@call': 'formatString', args: {value: 'not-a-child-id'}},
        {call: 'formatString', args: {value: 'not-a-child-id'}},
      ]) {
        assert.deepEqual(
          Array.from(
            getComponentReferences(
              {id: 'root', component: 'OpenBox', child: boundChild},
              openCatalog,
            ),
          ),
          [],
        );
        const model = new SurfaceComponentsModel(openCatalog);
        model.addComponent(new ComponentModel('root', 'OpenBox', {child: boundChild}, openCatalog));
        assert.doesNotThrow(() =>
          model.validateTopology({
            allowMissingRoot: false,
            allowDanglingReferences: false,
            allowOrphanComponents: false,
          }),
        );
      }
    });

    it('extracts only componentId from {componentId, "@path"} templates and passes strict validateTopology alongside z.object({}) containers', () => {
      const catalog = new Catalog('v10-tmpl-cat', '1.0', [
        {
          name: 'Repeater',
          schema: z.object({
            children: z.object({componentId: z.string(), '@path': z.string()}),
          }),
        },
        {
          name: 'EmptyWrapper',
          schema: z.object({}),
        },
        {
          name: 'LeafText',
          schema: z.object({text: z.string()}).strict(),
        },
      ]);

      const refs = Array.from(
        getComponentReferences(
          {
            id: 'root',
            component: 'Repeater',
            children: {componentId: 'wrapper', '@path': '/items'},
          },
          catalog,
        ),
      );
      assert.deepEqual(refs, [['wrapper', 'children.componentId']]);

      const model = new SurfaceComponentsModel(catalog);
      model.addComponent(
        new ComponentModel(
          'root',
          'Repeater',
          {children: {componentId: 'wrapper', '@path': '/items'}},
          catalog,
        ),
      );
      model.addComponent(new ComponentModel('wrapper', 'EmptyWrapper', {child: 'leaf'}, catalog));
      model.addComponent(new ComponentModel('leaf', 'LeafText', {text: 'Hi'}, catalog));

      assert.doesNotThrow(() =>
        model.validateTopology({
          allowMissingRoot: false,
          allowDanglingReferences: false,
          allowOrphanComponents: false,
        }),
      );
    });

    it('extracts template componentId when a property has nestedRefs from a [list, nested] union regardless of branch order', () => {
      const ComponentIdRef = z.string().describe('REF:common_types.json#/$defs/ComponentId');
      const TemplateBranch = z.object({
        componentId: ComponentIdRef,
        path: z.string(),
      });
      const StructuredBranch = z.array(
        z.object({
          title: z.string(),
          child: ComponentIdRef,
        }),
      );

      for (const sectionsSchema of [
        z.union([TemplateBranch, StructuredBranch]),
        z.union([StructuredBranch, TemplateBranch]),
      ]) {
        const catalog = new Catalog('union-nested-tmpl-cat', '0.9', [
          {
            name: 'FlexibleSections',
            schema: z.object({sections: sectionsSchema}),
          },
          {
            name: 'LeafText',
            schema: z.object({text: z.string()}).strict(),
          },
        ]);

        assert.deepEqual(
          Array.from(
            getComponentReferences(
              {
                id: 'root',
                component: 'FlexibleSections',
                sections: {componentId: 'item-tpl', path: '/items'},
              },
              catalog,
            ),
          ),
          [['item-tpl', 'sections.componentId']],
        );

        assert.deepEqual(
          Array.from(
            getComponentReferences(
              {
                id: 'root',
                component: 'FlexibleSections',
                sections: [{title: 'Not a component ID', child: 'c1'}],
              },
              catalog,
            ),
          ),
          [['c1', 'sections[0].child']],
        );

        const model = new SurfaceComponentsModel(catalog);
        model.addComponent(
          new ComponentModel(
            'root',
            'FlexibleSections',
            {sections: {componentId: 'item-tpl', path: '/items'}},
            catalog,
          ),
        );
        model.addComponent(new ComponentModel('item-tpl', 'LeafText', {text: 'Row'}, catalog));
        assert.doesNotThrow(() =>
          model.validateTopology({
            allowMissingRoot: false,
            allowDanglingReferences: false,
            allowOrphanComponents: false,
          }),
        );
      }
    });

    it('extracts both single string IDs and structured nested IDs from a [single, nested] union regardless of branch order', () => {
      const ComponentIdRef = z.string().describe('REF:common_types.json#/$defs/ComponentId');
      const StructuredBranch = z.array(
        z.object({
          title: z.string(),
          child: ComponentIdRef,
        }),
      );

      for (const slotSchema of [
        z.union([ComponentIdRef, StructuredBranch]),
        z.union([StructuredBranch, ComponentIdRef]),
      ]) {
        const catalog = new Catalog('union-single-nested-cat', '0.9', [
          {
            name: 'FlexibleSlot',
            schema: z.object({slot: slotSchema}),
          },
          {
            name: 'LeafText',
            schema: z.object({text: z.string()}).strict(),
          },
        ]);

        assert.deepEqual(
          Array.from(
            getComponentReferences(
              {
                id: 'root',
                component: 'FlexibleSlot',
                slot: 'leaf-1',
              },
              catalog,
            ),
          ),
          [['leaf-1', 'slot']],
        );

        assert.deepEqual(
          Array.from(
            getComponentReferences(
              {
                id: 'root',
                component: 'FlexibleSlot',
                slot: [{title: 'Row', child: 'c1'}],
              },
              catalog,
            ),
          ),
          [['c1', 'slot[0].child']],
        );

        const singleModel = new SurfaceComponentsModel(catalog);
        singleModel.addComponent(
          new ComponentModel('root', 'FlexibleSlot', {slot: 'leaf-1'}, catalog),
        );
        singleModel.addComponent(new ComponentModel('leaf-1', 'LeafText', {text: 'Hi'}, catalog));
        assert.doesNotThrow(() =>
          singleModel.validateTopology({
            allowMissingRoot: false,
            allowDanglingReferences: false,
            allowOrphanComponents: false,
          }),
        );
      }
    });
  });

  describe('Integrity and Recursion Errors', () => {
    it('instantiates A2uiIntegrityError and A2uiRecursionError with custom error codes', () => {
      const integrityErr = new A2uiIntegrityError('Integrity failed');
      assert.strictEqual(integrityErr.code, 'INTEGRITY_ERROR');
      assert.strictEqual(integrityErr.name, 'A2uiIntegrityError');

      const recursionErr = new A2uiRecursionError('Recursion exceeded');
      assert.strictEqual(recursionErr.code, 'RECURSION_ERROR');
      assert.strictEqual(recursionErr.name, 'A2uiRecursionError');
    });
  });
});
