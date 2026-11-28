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

import {Catalog} from '../../catalog/types.js';
import {
  ChildListSchema,
  ComponentIdSchema,
  DynamicBooleanSchema,
  DynamicNumberSchema,
  DynamicStringListSchema,
  DynamicStringSchema,
  DynamicValueSchema,
} from './common-types.js';
import {
  childList,
  componentId,
  dynamicBoolean,
  dynamicNumber,
  dynamicString,
  dynamicStringList,
  dynamicValue,
} from './helpers.js';

/** Returns what the catalog document says of each property of a component with this shape. */
function serialize(shape: z.ZodRawShape): Record<string, Record<string, unknown>> {
  const Card = {name: 'Card', schema: z.object(shape)};
  const {components} = new Catalog('https://example.com/cards', '0.9', [Card], []).toJson();
  const {properties} = (
    components as Record<string, {properties: Record<string, Record<string, unknown>>}>
  ).Card;
  return Object.fromEntries(Object.entries(properties).filter(([name]) => name in shape));
}

describe('schema helpers', () => {
  it('keep the description they are given in the catalog document', () => {
    assert.deepStrictEqual(
      serialize({
        header: componentId({description: 'The header.'}),
        items: childList({description: 'The items.'}),
        title: dynamicString('The title.'),
        price: dynamicNumber('The price.'),
        open: dynamicBoolean('Whether the card is open.'),
        value: dynamicValue('The value.'),
        tags: dynamicStringList('The tags.'),
      }),
      {
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
      },
    );
  });

  it('keep the shared schema and its description when given none or an empty one', () => {
    const shared = serialize({
      header: ComponentIdSchema,
      items: ChildListSchema,
      title: DynamicStringSchema,
      price: DynamicNumberSchema,
      open: DynamicBooleanSchema,
      value: DynamicValueSchema,
      tags: DynamicStringListSchema,
    });
    assert.deepStrictEqual(
      Object.fromEntries(Object.entries(shared).map(([name, property]) => [name, property.$ref])),
      {
        header: 'common_types.json#/$defs/ComponentId',
        items: 'common_types.json#/$defs/ChildList',
        title: 'common_types.json#/$defs/DynamicString',
        price: 'common_types.json#/$defs/DynamicNumber',
        open: 'common_types.json#/$defs/DynamicBoolean',
        value: 'common_types.json#/$defs/DynamicValue',
        tags: 'common_types.json#/$defs/DynamicStringList',
      },
    );
    for (const description of [undefined, '']) {
      assert.deepStrictEqual(
        serialize({
          header: componentId({description}),
          items: childList({description}),
          title: dynamicString(description),
          price: dynamicNumber(description),
          open: dynamicBoolean(description),
          value: dynamicValue(description),
          tags: dynamicStringList(description),
        }),
        shared,
      );
    }
  });
});
