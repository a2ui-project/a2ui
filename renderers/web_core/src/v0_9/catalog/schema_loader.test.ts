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

describe('Catalog.fromSchema & schema_loader', () => {
  const basicCatalogPath = resolve(
    process.cwd(),
    '../../specification/v0_9_1/catalogs/basic/catalog.json',
  );
  const basicCatalogJson = JSON.parse(readFileSync(basicCatalogPath, 'utf-8'));

  it('throws error when catalogId is missing', () => {
    const invalidJson = {
      components: {},
    };
    assert.throws(() => Catalog.fromSchema(invalidJson as any), /Catalog ID must be specified/);
  });

  it('loads basic catalog successfully and dynamically resolves weight and accessibility', () => {
    const catalog = Catalog.fromSchema(basicCatalogJson);

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

    // Verify weight is dynamically resolved from #/$defs/CatalogComponentCommon
    assert.ok(textShape.weight);
    const validWeight = textComp.schema.safeParse({text: 'Hello', weight: 2});
    assert.strictEqual(validWeight.success, true);

    // Verify accessibility is dynamically resolved from common_types.json#/$defs/ComponentCommon
    assert.ok(textShape.accessibility);
    const validAccessibility = textComp.schema.safeParse({
      text: 'Hello',
      accessibility: {label: 'Heading text'},
    });
    assert.strictEqual(validAccessibility.success, true);

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
    const catalog = Catalog.fromSchema(basicCatalogJson);
    assert.ok(catalog.functions.size > 0);

    const reqFn = catalog.functions.get('required');
    assert.ok(reqFn);
    assert.strictEqual(reqFn.name, 'required');
    assert.strictEqual(reqFn.returnType, 'boolean');
  });

  it('is catalog-agnostic and does not inject weight into custom catalogs lacking weight in $defs', () => {
    const customCatalog = {
      catalogId: 'https://example.com/custom_catalog.json',
      components: {
        CustomButton: {
          type: 'object',
          allOf: [
            {
              $ref: 'https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon',
            },
            {
              properties: {
                label: {type: 'string'},
              },
              required: ['label'],
            },
          ],
        },
      },
    };

    const catalog = Catalog.fromSchema(customCatalog);
    const btn = catalog.components.get('CustomButton');
    assert.ok(btn);

    const shape = (btn.schema as z.ZodObject<any>).shape;
    // Protocol accessibility is present
    assert.ok(shape.accessibility);
    assert.ok(shape.label);
    // weight is NOT present in custom catalog without CatalogComponentCommon
    assert.strictEqual(shape.weight, undefined);
  });

  it('dynamically resolves custom local $defs in allOf and property references', () => {
    const catalogWithDefs = {
      catalogId: 'https://example.com/custom_defs.json',
      $defs: {
        CustomHeaderCommon: {
          type: 'object',
          properties: {
            themeColor: {type: 'string'},
            badgeCount: {type: 'integer'},
          },
        },
        StatusEnum: {
          type: 'string',
          enum: ['active', 'paused', 'archived'],
        },
      },
      components: {
        HeaderWidget: {
          allOf: [
            {
              $ref: '#/$defs/CustomHeaderCommon',
            },
            {
              properties: {
                title: {type: 'string'},
                status: {$ref: '#/$defs/StatusEnum'},
              },
              required: ['title'],
            },
          ],
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogWithDefs);
    const widget = catalog.components.get('HeaderWidget');
    assert.ok(widget);

    const shape = (widget.schema as z.ZodObject<any>).shape;
    assert.ok(shape.themeColor);
    assert.ok(shape.badgeCount);
    assert.ok(shape.title);
    assert.ok(shape.status);

    const valid = widget.schema.safeParse({
      title: 'Dashboard',
      themeColor: '#fff',
      badgeCount: 5,
      status: 'active',
    });
    assert.strictEqual(valid.success, true);

    const invalidStatus = widget.schema.safeParse({
      title: 'Dashboard',
      status: 'invalid_status',
    });
    assert.strictEqual(invalidStatus.success, false);
  });

  it('handles v1.0 style flat component schemas without allOf', () => {
    const v1Catalog = {
      catalogId: 'https://example.com/v1_catalog.json',
      components: {
        V1Card: {
          type: 'object',
          properties: {
            title: {type: 'string'},
            elevation: {type: 'number'},
          },
          required: ['title'],
        },
      },
    };

    const catalog = Catalog.fromSchema(v1Catalog);
    const card = catalog.components.get('V1Card');
    assert.ok(card);

    const shape = (card.schema as z.ZodObject<any>).shape;
    assert.ok(shape.title);
    assert.ok(shape.elevation);
    assert.strictEqual(shape.weight, undefined);

    const valid = card.schema.safeParse({title: 'Card 1', elevation: 2});
    assert.strictEqual(valid.success, true);
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

    const catalog = Catalog.fromSchema(catalogWithEnums);
    const widget = catalog.components.get('EnumWidget');
    assert.ok(widget);

    const valid = widget.schema.safeParse({numEnum: 2, singleEnum: 'only_one'});
    assert.strictEqual(valid.success, true);

    const invalid = widget.schema.safeParse({numEnum: 99});
    assert.strictEqual(invalid.success, false);
  });
});
