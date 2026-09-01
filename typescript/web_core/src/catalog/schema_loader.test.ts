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

  it('extracts allowedParents and allowedChildren on components', () => {
    const catalogJson = {
      catalogId: 'https://example.com/hierarchy_catalog.json',
      components: {
        ParentContainer: {
          properties: {title: {type: 'string'}},
          allowedChildren: ['ChildWidget', 'Text'],
        },
        ChildWidget: {
          properties: {value: {type: 'string'}},
          allowedParents: ['ParentContainer'],
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    const parentComp = catalog.components.get('ParentContainer');
    const childComp = catalog.components.get('ChildWidget');

    assert.ok(parentComp);
    assert.deepStrictEqual(parentComp.allowedChildren, ['ChildWidget', 'Text']);
    assert.strictEqual(parentComp.allowedParents, undefined);

    assert.ok(childComp);
    assert.deepStrictEqual(childComp.allowedParents, ['ParentContainer']);
    assert.strictEqual(childComp.allowedChildren, undefined);
  });

  it('filters permitted functions via anyFunction.oneOf when declared', () => {
    const catalogJson = {
      catalogId: 'https://example.com/filtered_functions_catalog.json',
      $defs: {
        anyFunction: {
          oneOf: [{$ref: '#/functions/allowedFunc'}],
        },
      },
      components: {},
      functions: {
        allowedFunc: {
          description: 'Permitted function',
          returnType: 'string',
          parameters: {
            properties: {arg1: {type: 'string'}},
          },
        },
        disallowedFunc: {
          description: 'Excluded function',
          returnType: 'number',
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    assert.strictEqual(catalog.functions.size, 1);
    assert.ok(catalog.functions.has('allowedFunc'));
    assert.strictEqual(catalog.functions.has('disallowedFunc'), false);
  });

  it('loads themeSchema and instructions correctly', () => {
    const catalogJson = {
      catalogId: 'https://example.com/theme_catalog.json',
      instructions: 'Use minimal styling and concise copy.',
      theme: {
        type: 'object',
        properties: {
          primaryColor: {type: 'string'},
          borderRadius: {type: 'number'},
        },
        required: ['primaryColor'],
      },
      components: {},
    };

    const catalog = Catalog.fromSchema(catalogJson);
    assert.strictEqual(catalog.instructions, 'Use minimal styling and concise copy.');
    assert.ok(catalog.themeSchema instanceof z.ZodObject);

    const validTheme = catalog.themeSchema.safeParse({
      primaryColor: '#ff0000',
      borderRadius: 8,
    });
    assert.strictEqual(validTheme.success, true);

    const invalidTheme = catalog.themeSchema.safeParse({
      borderRadius: 8,
    });
    assert.strictEqual(invalidTheme.success, false);
  });

  it('filters out all functions when anyFunction.oneOf is declared but empty', () => {
    const catalogJson = {
      catalogId: 'https://example.com/empty_filtered_functions_catalog.json',
      $defs: {
        anyFunction: {
          oneOf: [],
        },
      },
      components: {},
      functions: {
        allowedFunc: {
          description: 'Permitted function',
          returnType: 'string',
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    assert.strictEqual(catalog.functions.size, 0);
  });

  it('correctly unescapes JSON Pointer sequences in anyFunction.oneOf references', () => {
    const catalogJson = {
      catalogId: 'https://example.com/escaped_functions_catalog.json',
      $defs: {
        anyFunction: {
          oneOf: [{$ref: '#/functions/my~1slash'}, {$ref: '#/functions/my~0tilde'}],
        },
      },
      components: {},
      functions: {
        'my/slash': {
          description: 'Function with slash',
          returnType: 'string',
        },
        'my~tilde': {
          description: 'Function with tilde',
          returnType: 'string',
        },
        'otherFunc': {
          description: 'Other function',
          returnType: 'string',
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    assert.strictEqual(catalog.functions.size, 2);
    assert.ok(catalog.functions.has('my/slash'));
    assert.ok(catalog.functions.has('my~tilde'));
    assert.strictEqual(catalog.functions.has('otherFunc'), false);
  });

  it('filters out all components when anyComponent.oneOf is declared but empty', () => {
    const catalogJson = {
      catalogId: 'https://example.com/empty_components_catalog.json',
      $defs: {
        anyComponent: {
          oneOf: [],
        },
      },
      components: {
        Button: {
          properties: {label: {type: 'string'}},
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    assert.strictEqual(catalog.components.size, 0);
  });

  it('correctly unescapes JSON Pointer sequences in anyComponent.oneOf references', () => {
    const catalogJson = {
      catalogId: 'https://example.com/escaped_components_catalog.json',
      $defs: {
        anyComponent: {
          oneOf: [{$ref: '#/components/my~1comp'}, {$ref: '#/components/my~0comp'}],
        },
      },
      components: {
        'my/comp': {
          properties: {title: {type: 'string'}},
        },
        'my~comp': {
          properties: {title: {type: 'string'}},
        },
        'otherComp': {
          properties: {title: {type: 'string'}},
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    assert.strictEqual(catalog.components.size, 2);
    assert.ok(catalog.components.has('my/comp'));
    assert.ok(catalog.components.has('my~comp'));
    assert.strictEqual(catalog.components.has('otherComp'), false);
  });

  it('filters non-string elements from allowedParents and allowedChildren', () => {
    const catalogJson = {
      catalogId: 'https://example.com/sanitized_hierarchy_catalog.json',
      components: {
        StrictNode: {
          properties: {id: {type: 'string'}},
          allowedParents: ['ParentValid', 123, null],
          allowedChildren: ['ChildValid', false, {}],
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    const comp = catalog.components.get('StrictNode');
    assert.ok(comp);
    assert.deepStrictEqual(comp.allowedParents, ['ParentValid']);
    assert.deepStrictEqual(comp.allowedChildren, ['ChildValid']);
  });

  it('correctly parses allowedCallers and requiresUserActivation on functions', () => {
    const catalogJson = {
      catalogId: 'https://example.com/func_metadata_catalog.json',
      components: {},
      functions: {
        secureAction: {
          returnType: 'void',
          allowedCallers: 'rendererOnly',
          requiresUserActivation: true,
        },
        schemaConstAction: {
          properties: {
            returnType: {const: 'string'},
            allowedCallers: {const: 'agentOnly'},
            requiresUserActivation: {const: false},
          },
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    const fn1 = catalog.functions.get('secureAction');
    assert.ok(fn1);
    assert.strictEqual(fn1.returnType, 'void');
    assert.strictEqual(fn1.allowedCallers, 'rendererOnly');
    assert.strictEqual(fn1.requiresUserActivation, true);

    const fn2 = catalog.functions.get('schemaConstAction');
    assert.ok(fn2);
    assert.strictEqual(fn2.returnType, 'string');
    assert.strictEqual(fn2.allowedCallers, 'agentOnly');
    assert.strictEqual(fn2.requiresUserActivation, false);
  });

  it('applies passthrough when additionalProperties is a schema object', () => {
    const catalogJson = {
      catalogId: 'https://example.com/add_props_catalog.json',
      components: {
        FlexibleCard: {
          type: 'object',
          properties: {
            title: {type: 'string'},
          },
          required: ['title'],
          additionalProperties: {type: 'string'},
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    const card = catalog.components.get('FlexibleCard');
    assert.ok(card);
    const result = card.schema.safeParse({
      title: 'Valid title',
      extraField: 'any string value',
    });
    assert.strictEqual(result.success, true);
  });

  it('preserves component and id properties in theme schemas', () => {
    const catalogJson = {
      catalogId: 'https://example.com/theme_props_catalog.json',
      components: {},
      theme: {
        type: 'object',
        properties: {
          id: {type: 'string'},
          component: {type: 'string'},
          primaryColor: {type: 'string'},
        },
        required: ['id', 'component', 'primaryColor'],
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    assert.ok(catalog.themeSchema);
    const result = catalog.themeSchema.safeParse({
      id: 'theme-1',
      component: 'DarkTheme',
      primaryColor: '#000',
    });
    assert.strictEqual(result.success, true);
  });

  it('applies passthrough when unevaluatedProperties is true or a schema object', () => {
    const catalogJson = {
      catalogId: 'https://example.com/uneval_props_catalog.json',
      components: {
        OpenCard: {
          type: 'object',
          properties: {
            title: {type: 'string'},
          },
          unevaluatedProperties: true,
        },
        SchemaCard: {
          type: 'object',
          properties: {
            title: {type: 'string'},
          },
          unevaluatedProperties: {type: 'number'},
        },
        StrictCard: {
          type: 'object',
          properties: {
            title: {type: 'string'},
          },
          unevaluatedProperties: false,
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    const openCard = catalog.components.get('OpenCard');
    const schemaCard = catalog.components.get('SchemaCard');
    const strictCard = catalog.components.get('StrictCard');

    assert.ok(openCard);
    assert.ok(schemaCard);
    assert.ok(strictCard);

    assert.strictEqual(openCard.schema.safeParse({title: 'A', extra: 'allowed'}).success, true);
    assert.strictEqual(schemaCard.schema.safeParse({title: 'B', extra: 123}).success, true);
    assert.strictEqual(strictCard.schema.safeParse({title: 'C', extra: 'rejected'}).success, false);
  });

  it('converts multi-branch oneOf unions to z.union', () => {
    const catalogJson = {
      $id: 'https://example.com/union-cat',
      title: 'Union Catalog',
      components: {
        FlexibleInput: {
          type: 'object',
          properties: {
            value: {
              oneOf: [{type: 'string'}, {type: 'number'}, {type: 'boolean'}],
            },
          },
          required: ['value'],
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson);
    const inputComp = catalog.components.get('FlexibleInput');
    assert.ok(inputComp);

    assert.strictEqual(inputComp.schema.safeParse({value: 'hello'}).success, true);
    assert.strictEqual(inputComp.schema.safeParse({value: 42}).success, true);
    assert.strictEqual(inputComp.schema.safeParse({value: true}).success, true);
    assert.strictEqual(inputComp.schema.safeParse({value: {invalid: 'obj'}}).success, false);
  });
});
