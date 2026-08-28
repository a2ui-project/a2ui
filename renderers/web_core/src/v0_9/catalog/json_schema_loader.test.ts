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
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {Catalog} from './types.js';

describe('Catalog.fromJson & json_schema_loader', () => {
  const basicCatalogPath = resolve(
    process.cwd(),
    '../../specification/v0_9_1/catalogs/basic/catalog.json',
  );
  const basicCatalogJson = JSON.parse(readFileSync(basicCatalogPath, 'utf-8'));

  it('throws error when catalogId is missing', () => {
    const invalidJson = {
      components: {},
    };
    assert.throws(() => Catalog.fromJson(invalidJson as any), /Catalog ID must be specified/);
  });

  it('loads basic catalog successfully into Catalog<ComponentApi>', () => {
    const catalog = Catalog.fromJson(basicCatalogJson);

    assert.strictEqual(
      catalog.id,
      'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
    );
    assert.ok(catalog.components.size > 0);

    // Text component
    const textComp = catalog.components.get('Text');
    assert.ok(textComp);
    assert.strictEqual(textComp.name, 'Text');
    assert.ok(textComp.schema instanceof z.ZodObject);

    // Verify envelope fields ('component', 'id') are omitted
    const textShape = (textComp.schema as z.ZodObject<any>).shape;
    assert.strictEqual(textShape.id, undefined);
    assert.strictEqual(textShape.component, undefined);

    // Verify text property exists and validates strings & data bindings
    assert.ok(textShape.text);
    const validText = textComp.schema.safeParse({text: 'Hello World'});
    assert.strictEqual(validText.success, true);

    const validBinding = textComp.schema.safeParse({
      text: {path: '/user/name'},
    });
    assert.strictEqual(validBinding.success, true);

    // Row component with ChildList
    const rowComp = catalog.components.get('Row');
    assert.ok(rowComp);
    const rowShape = (rowComp.schema as z.ZodObject<any>).shape;
    assert.ok(rowShape.children);

    const validChildren = rowComp.schema.safeParse({
      children: ['c1', 'c2'],
    });
    assert.strictEqual(validChildren.success, true);

    // Button component with Action
    const btnComp = catalog.components.get('Button');
    assert.ok(btnComp);
    const btnShape = (btnComp.schema as z.ZodObject<any>).shape;
    assert.ok(btnShape.action);

    const validAction = btnComp.schema.safeParse({
      child: 'txt1',
      action: {event: {name: 'click_me'}},
    });
    assert.strictEqual(validAction.success, true);
  });

  it('parses functions from catalog into FunctionApi map', () => {
    const catalog = Catalog.fromJson(basicCatalogJson);
    assert.ok(catalog.functions.size > 0);

    const reqFn = catalog.functions.get('required');
    assert.ok(reqFn);
    assert.strictEqual(reqFn.name, 'required');
    assert.strictEqual(reqFn.returnType, 'boolean');
  });

  it('merges both allOf and top-level properties and resolves required fields in two passes', () => {
    const catalogWithAllOf = {
      catalogId: 'https://example.com/allof_catalog.json',
      components: {
        TestWidget: {
          allOf: [
            {
              properties: {
                baseProp: {type: 'string'},
              },
            },
          ],
          properties: {
            extraProp: {type: 'integer'},
          },
          required: ['baseProp', 'extraProp'],
        },
      },
    };

    const catalog = Catalog.fromJson(catalogWithAllOf);
    const widget = catalog.components.get('TestWidget');
    assert.ok(widget);

    // Both baseProp and extraProp must exist
    const shape = (widget.schema as z.ZodObject<any>).shape;
    assert.ok(shape.baseProp);
    assert.ok(shape.extraProp);

    // baseProp was defined in allOf, but marked required at root: must be required
    const missingBase = widget.schema.safeParse({extraProp: 10});
    assert.strictEqual(missingBase.success, false);

    // extraProp is an integer: must reject floats
    const floatVal = widget.schema.safeParse({baseProp: 'hello', extraProp: 10.5});
    assert.strictEqual(floatVal.success, false);

    const intVal = widget.schema.safeParse({baseProp: 'hello', extraProp: 10});
    assert.strictEqual(intVal.success, true);
  });

  it('safely converts non-string enums and handles defensive prop schemas', () => {
    const catalogWithEnums = {
      catalogId: 'https://example.com/enum_catalog.json',
      components: {
        EnumWidget: {
          properties: {
            numEnum: {enum: [1, 2, 3]},
            singleEnum: {enum: ['only_one']},
            invalidProp: null,
          },
        },
      },
    };

    const catalog = Catalog.fromJson(catalogWithEnums);
    const widget = catalog.components.get('EnumWidget');
    assert.ok(widget);

    const valid = widget.schema.safeParse({numEnum: 2, singleEnum: 'only_one'});
    assert.strictEqual(valid.success, true);

    const invalid = widget.schema.safeParse({numEnum: 99});
    assert.strictEqual(invalid.success, false);
  });
});
