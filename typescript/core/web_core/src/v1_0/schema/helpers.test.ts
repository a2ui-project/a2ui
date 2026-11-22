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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {z} from 'zod';

import * as v1_0 from './index.js';
import {Catalog} from '../../catalog/types.js';
import {spec} from '../../catalog/spec_annotations.js';

const PROSE = 'The card to show inside this one.';

/** The part of a serialized component definition that holds its own properties. */
interface SerializedComponent {
  readonly allOf?: ReadonlyArray<{readonly properties?: Record<string, unknown>}>;
}

/** The schema of a property in a serialized catalog document. */
function serializedProperty(
  document: Readonly<Record<string, unknown>>,
  component: string,
  property: string,
): unknown {
  const components = document['components'] as Record<string, SerializedComponent>;
  return components[component].allOf?.at(-1)?.properties?.[property];
}

/** The `description` of the schema each helper returns. */
const DESCRIBED_SCHEMAS = {
  componentId: () => v1_0.componentId({description: PROSE}),
  childList: () => v1_0.childList({description: PROSE}),
  dynamicString: () => v1_0.dynamicString(PROSE),
  dynamicNumber: () => v1_0.dynamicNumber(PROSE),
  dynamicBoolean: () => v1_0.dynamicBoolean(PROSE),
  dynamicValue: () => v1_0.dynamicValue(PROSE),
  dynamicStringList: () => v1_0.dynamicStringList(PROSE),
};

describe('v1.0 schema helpers', () => {
  for (const [name, make] of Object.entries(DESCRIBED_SCHEMAS)) {
    it(`${name} keeps the caller's description after the REF: marker`, () => {
      const description = make().description;

      assert.ok(description !== undefined, `${name} returned a schema with no description`);
      assert.ok(description.startsWith('REF:#/$defs/'), `${name} dropped its REF: marker`);
      assert.ok(
        description.endsWith(`|${PROSE}`),
        `${name} did not append the description it was given, got '${description}'`,
      );
      assert.ok(
        !description.includes('${'),
        `${name} left a template placeholder in the description, got '${description}'`,
      );
    });
  }

  it('componentId keeps its REF: marker and its description in a catalog document', () => {
    const component = spec(
      z
        .object({
          'id': v1_0.ComponentIdSchema,
          'component': z.literal('Card'),
          'child': v1_0.componentId({description: PROSE}),
        })
        .strict(),
      {mixins: ['ComponentCommon']},
    );
    const catalog = new Catalog(
      'https://example.com/catalog.json',
      '1.0',
      [{name: 'Card', schema: component}],
      [],
    );

    assert.deepStrictEqual(serializedProperty(catalog.toJson(), 'Card', 'child'), {
      $ref: 'common_types.json#/$defs/ComponentId',
      description: PROSE,
    });
  });
});
