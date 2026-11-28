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

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {z} from 'zod';

import {Catalog, type ComponentApi} from '../../catalog/types.js';
import {
  childList,
  componentId,
  dynamicBoolean,
  dynamicNumber,
  dynamicString,
  dynamicStringList,
  dynamicValue,
} from './helpers.js';

describe('schema helpers', () => {
  it('keep the description they are given in the catalog document', () => {
    const Card: ComponentApi = {
      name: 'Card',
      schema: z.object({
        header: componentId({description: 'The header.'}),
        items: childList({description: 'The items.'}),
        title: dynamicString('The title.'),
        price: dynamicNumber('The price.'),
        open: dynamicBoolean('Whether the card is open.'),
        value: dynamicValue('The value.'),
        tags: dynamicStringList('The tags.'),
      }),
    };
    const {components} = new Catalog('https://example.com/cards', '1.0', [Card], []).toJson();
    assert.deepStrictEqual((components as Record<string, {properties: unknown}>).Card.properties, {
      component: {const: 'Card'},
      header: {$ref: 'common_types.json#/$defs/ComponentId', description: 'The header.'},
      items: {$ref: 'common_types.json#/$defs/ChildList', description: 'The items.'},
      title: {$ref: 'common_types.json#/$defs/DynamicString', description: 'The title.'},
      price: {$ref: 'common_types.json#/$defs/DynamicNumber', description: 'The price.'},
      open: {
        $ref: 'common_types.json#/$defs/DynamicBoolean',
        description: 'Whether the card is open.',
      },
      value: {$ref: 'common_types.json#/$defs/DynamicValue', description: 'The value.'},
      tags: {$ref: 'common_types.json#/$defs/DynamicStringList', description: 'The tags.'},
    });
  });
});
