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
import {describe, it} from 'node:test';

import type {ComponentApi} from '../catalog/types.js';
import {BASIC_COMPONENTS as V10_BASIC_COMPONENTS} from '../catalogs/basic/v1/components/basic_components.js';
import type {SchemaDoc} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';
import {cursorOf} from '../test/schema.js';
import {BASIC_COMPONENTS as V09_BASIC_COMPONENTS} from '../v0_9/basic_catalog/components/basic_components.js';
import V09BasicCatalog from '../v0_9/schemas/catalogs/basic/catalog.json' with {type: 'json'};
import V09CommonTypes from '../v0_9/schemas/common_types.json' with {type: 'json'};
import {V09_CHILD_REF_OPTIONS} from '../v0_9/standard_defs.js';
import V10BasicCatalog from '../v1_0/schemas/catalogs/basic/catalog.json' with {type: 'json'};
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import {V10_CHILD_REF_OPTIONS} from '../v1_0/standard_defs.js';
import {type BehaviorNode, scrapeComponentBehavior} from './generic-binder.js';
import {type ChildRefAnalysisOptions, extractRefFields} from './ref-fields.js';

interface SpecCatalogCase {
  version: string;
  catalog: {components: Record<string, JsonSchema>};
  doc: SchemaDoc;
  apis: ComponentApi[];
  options: ChildRefAnalysisOptions;
  /**
   * Keys only the spec JSON declares, each with the reason. The Zod APIs
   * describe a component's properties; the spec component schemas also
   * declare the envelope keys the binder never receives as properties.
   */
  specOnlyKeys: Record<string, string>;
}

const CASES: SpecCatalogCase[] = [
  {
    version: '0.9',
    catalog: V09BasicCatalog as unknown as SpecCatalogCase['catalog'],
    doc: {
      root: V09BasicCatalog as JsonSchema,
      defs: {
        'https://a2ui.org/specification/v0_9/common_types.json': V09CommonTypes as JsonSchema,
      },
    },
    apis: V09_BASIC_COMPONENTS,
    options: V09_CHILD_REF_OPTIONS,
    specOnlyKeys: {
      id: 'envelope key from ComponentCommon; the Zod API leaves it out',
      component: 'envelope discriminator; the Zod API leaves it out',
    },
  },
  {
    version: '1.0',
    catalog: V10BasicCatalog as unknown as SpecCatalogCase['catalog'],
    doc: {
      root: V10BasicCatalog as JsonSchema,
      defs: {'common_types.json': V10CommonTypes as JsonSchema},
    },
    apis: V10_BASIC_COMPONENTS,
    options: V10_CHILD_REF_OPTIONS,
    specOnlyKeys: {
      component: 'envelope discriminator; the Zod API leaves it out',
    },
  },
];

function shapeOf(behavior: BehaviorNode): Record<string, BehaviorNode> {
  assert.strictEqual(behavior.type, 'OBJECT');
  return behavior.type === 'OBJECT' ? behavior.shape : {};
}

/** Single-child slots are the frozen child-ref `STATIC` sentinel. */
const isChildRefStatic = (node: BehaviorNode | undefined) =>
  node?.type === 'STATIC' && Object.isFrozen(node);

describe('Spec basic catalog component behaviors', () => {
  for (const c of CASES) {
    describe(`v${c.version}`, () => {
      const scrapeSpec = (name: string) => {
        const node = c.catalog.components[name];
        assert.ok(node, `spec catalog defines ${name}`);
        return scrapeComponentBehavior(node, c.doc, c.options);
      };

      it('scrapes every spec component like the bridged Zod API of the same component', () => {
        assert.deepStrictEqual(
          new Set(c.apis.map(api => api.name)),
          new Set(Object.keys(c.catalog.components)),
        );
        for (const api of c.apis) {
          const spec = scrapeSpec(api.name);
          const bridged = cursorOf(api.schema, c.version);
          const zod = scrapeComponentBehavior(bridged.node, bridged.doc, c.options);
          assert.strictEqual(
            spec.type === 'OBJECT' && spec.catchall,
            zod.type === 'OBJECT' && zod.catchall,
          );
          const specShape = shapeOf(spec);
          const zodShape = shapeOf(zod);
          for (const key of new Set([...Object.keys(specShape), ...Object.keys(zodShape)])) {
            if (Object.hasOwn(c.specOnlyKeys, key) && !Object.hasOwn(zodShape, key)) {
              assert.deepStrictEqual(specShape[key], {type: 'STATIC'}, `${api.name}.${key}`);
              continue;
            }
            assert.deepStrictEqual(specShape[key], zodShape[key], `${api.name}.${key}`);
            assert.strictEqual(
              isChildRefStatic(specShape[key]),
              isChildRefStatic(zodShape[key]),
              `${api.name}.${key} child-ref slot`,
            );
          }
        }
      });

      it('keeps the properties of a component composed with the Checkable mixin', () => {
        const button = shapeOf(scrapeSpec('Button'));
        assert.deepStrictEqual(button.action, {type: 'ACTION'});
        assert.ok(isChildRefStatic(button.child), 'Button.child is a child-ref slot');
        assert.deepStrictEqual(
          extractRefFields(c.catalog.components['Button'], c.doc, c.options).get('child'),
          {kind: 'single'},
        );
        const checksKey = c.version === '1.0' ? '@checks' : 'checks';
        assert.deepStrictEqual(button[checksKey], {type: 'CHECKABLE'});

        const textField = shapeOf(scrapeSpec('TextField'));
        assert.deepStrictEqual(textField.value, {type: 'DYNAMIC'});
      });
    });
  }
});
