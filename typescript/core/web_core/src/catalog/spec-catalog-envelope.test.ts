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

import {v09BasicCatalog, v1BasicCatalog} from '../test/basic_catalogs.js';
import {objectProperties, type SchemaCursor, type SchemaDoc} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';
import {cursorOf} from '../test/schema.js';
import V09BasicCatalog from '../v0_9/schemas/catalogs/basic/catalog.json' with {type: 'json'};
import V09CommonTypes from '../v0_9/schemas/common_types.json' with {type: 'json'};
import V10BasicCatalog from '../v1_0/schemas/catalogs/basic/catalog.json' with {type: 'json'};
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import {componentMixinLayout, type ComponentMixinLayout} from './component_envelope.js';
import type {ComponentApi} from './types.js';
import {isDynamicBooleanSchema} from './validation_result_coercion.js';

interface SpecCatalogCase {
  version: string;
  catalog: {components: Record<string, JsonSchema>};
  doc: SchemaDoc;
  apis: ComponentApi[];
  /**
   * Keys only the spec JSON declares, each with the reason. The catalog entries
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
    apis: [...v09BasicCatalog.components.values()],
    specOnlyKeys: {
      id: 'envelope key from ComponentCommon; the catalog entry leaves it out',
      component: 'envelope discriminator; the catalog entry leaves it out',
    },
  },
  {
    version: '1.0',
    catalog: V10BasicCatalog as unknown as SpecCatalogCase['catalog'],
    doc: {
      root: V10BasicCatalog as JsonSchema,
      defs: {'common_types.json': V10CommonTypes as JsonSchema},
    },
    apis: [...v1BasicCatalog.components.values()],
    specOnlyKeys: {
      component: 'envelope discriminator; the catalog entry leaves it out',
    },
  },
];

const plain = ({customKeys, schemaKeys}: ComponentMixinLayout) => ({
  customKeys: [...customKeys].sort(),
  schemaKeys: Object.fromEntries(schemaKeys),
});

function properties({node, doc}: SchemaCursor): Record<string, SchemaCursor> {
  const shape = objectProperties(node, doc);
  assert.ok(shape, 'component schema is an object');
  return shape.properties;
}

describe('Spec basic catalog component envelopes', () => {
  for (const c of CASES) {
    describe(`v${c.version}`, () => {
      const spec = (name: string): SchemaCursor => {
        const node = c.catalog.components[name];
        assert.ok(node, `spec catalog defines ${name}`);
        return {node, doc: c.doc};
      };

      it('lays out the mixins of every spec component like the catalog entry loaded from it', () => {
        assert.deepStrictEqual(
          new Set(c.apis.map(api => api.name)),
          new Set(Object.keys(c.catalog.components)),
        );
        for (const api of c.apis) {
          assert.deepStrictEqual(
            plain(componentMixinLayout(spec(api.name))),
            plain(componentMixinLayout(cursorOf(api.schema, c.version))),
            api.name,
          );
        }
      });

      it('finds the DynamicBoolean properties of every spec component like the catalog entry loaded from it', () => {
        for (const api of c.apis) {
          const specProps = properties(spec(api.name));
          const codeProps = properties(cursorOf(api.schema, c.version));
          for (const key of new Set([...Object.keys(specProps), ...Object.keys(codeProps)])) {
            if (Object.hasOwn(c.specOnlyKeys, key) && !Object.hasOwn(codeProps, key)) continue;
            assert.ok(specProps[key] && codeProps[key], `${api.name}.${key} declared by both`);
            assert.strictEqual(
              isDynamicBooleanSchema(specProps[key].node, specProps[key].doc),
              isDynamicBooleanSchema(codeProps[key].node, codeProps[key].doc),
              `${api.name}.${key}`,
            );
          }
        }
      });

      it('lays out the checkable spec components with their checks mixin', () => {
        const checksKey = c.version === '1.0' ? '@checks' : 'checks';
        assert.strictEqual(
          componentMixinLayout(spec('Button')).schemaKeys.get('checks'),
          checksKey,
        );
        assert.strictEqual(componentMixinLayout(spec('Text')).schemaKeys.has('checks'), false);
        const checkBox = properties(spec('CheckBox'));
        assert.ok(isDynamicBooleanSchema(checkBox.value.node, checkBox.value.doc));
      });
    });
  }
});
