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
import {analyzeChildRefSchema} from './reference-map.js';
import {V10_CHILD_REF_OPTIONS} from '../v1_0/standard_defs.js';

describe('Catalog.fromSchema & schema_loader', () => {
  const basicCatalogPath = resolve(
    process.cwd(),
    '../../specification/v0_9_1/catalogs/basic/catalog.json',
  );
  const basicCatalogJson = JSON.parse(readFileSync(basicCatalogPath, 'utf-8'));

  it('loads basic catalog successfully and dynamically resolves weight and accessibility', () => {
    const catalog = Catalog.fromSchema(basicCatalogJson, '0.9');

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

  it('resolves the Checkable mixin referenced from an external document', () => {
    // Checkable arrives as an allOf $ref into common_types.json, a document the loader never
    // reads. It used to fall through every branch and be discarded without an error, taking
    // `checks` off every input component with it.
    const catalog = Catalog.fromSchema(basicCatalogJson);

    for (const name of [
      'Button',
      'TextField',
      'CheckBox',
      'ChoicePicker',
      'Slider',
      'DateTimeInput',
    ]) {
      const comp = catalog.components.get(name);
      assert.ok(comp, `${name} is missing from the basic catalog`);
      const shape = (comp.schema as z.ZodObject<any>).shape;
      assert.ok(shape.checks, `${name} lost its checks property`);
    }

    const button = catalog.components.get('Button');
    assert.ok(button);
    const withChecks = button.schema.safeParse({
      child: 'txt1',
      action: {event: {name: 'submit'}},
      checks: [{condition: {path: '/form/valid'}, message: 'This field is required'}],
    });
    assert.strictEqual(withChecks.success, true);

    // The property is typed, not a free-form escape hatch.
    const badChecks = button.schema.safeParse({
      child: 'txt1',
      action: {event: {name: 'submit'}},
      checks: 'always',
    });
    assert.strictEqual(badChecks.success, false);
  });

  it('resolves an external mixin written as a relative reference', () => {
    // v1.0 catalogs spell the same reference without the absolute URL prefix.
    const catalog = Catalog.fromSchema({
      catalogId: 'test_relative_checkable',
      protocolVersion: 'v1.0',
      components: {
        Input: {
          type: 'object',
          allOf: [
            {$ref: 'common_types.json#/$defs/Checkable'},
            {type: 'object', properties: {label: {type: 'string'}}},
          ],
        },
      },
    } as any);

    const input = catalog.components.get('Input');
    assert.ok(input);
    const shape = (input.schema as z.ZodObject<any>).shape;
    assert.ok(shape.checks);
    assert.ok(shape.label);
  });

  it('resolves the Child reference from common_types.json', () => {
    const v10BasicCatalogPath = resolve(process.cwd(), '../../catalogs/basic/v1/catalog.json');
    const v10BasicCatalogJson = JSON.parse(readFileSync(v10BasicCatalogPath, 'utf-8'));
    const catalog = Catalog.fromSchema(v10BasicCatalogJson);

    // The regression was not that the description stamp went missing, but that
    // `analyzeChildRefSchema` stopped reporting these properties as child references at
    // all, which silently emptied the reference map for v1.0. Assert the outcome, and the
    // stamp only as a secondary detail.
    const expectedChildProps: ReadonlyArray<readonly [string, string]> = [
      ['Card', 'child'],
      ['Button', 'child'],
      ['Modal', 'trigger'],
      ['Modal', 'content'],
    ];

    for (const [componentName, propName] of expectedChildProps) {
      const component = catalog.components.get(componentName);
      assert.ok(component, `${componentName} is missing from the v1.0 basic catalog`);

      const shape = (component.schema as z.ZodObject<any>).shape;
      const prop = shape[propName];
      assert.ok(prop, `${componentName}.${propName} is missing`);

      const analysis = analyzeChildRefSchema(prop, V10_CHILD_REF_OPTIONS);
      assert.equal(
        analysis.isChild,
        true,
        `${componentName}.${propName} is not recognised as a child reference`,
      );
      assert.ok(
        prop.description?.includes('REF:common_types.json#/$defs/Child'),
        `${componentName}.${propName} lost its REF description stamp`,
      );
    }
  });

  it('ignores an external reference that names no canonical protocol type', () => {
    const catalog = Catalog.fromSchema({
      catalogId: 'test_unknown_external_ref',
      protocolVersion: 'v1.0',
      components: {
        Widget: {
          type: 'object',
          allOf: [
            {$ref: 'other_document.json#/$defs/NotAProtocolType'},
            {type: 'object', properties: {label: {type: 'string'}}},
          ],
        },
      },
    } as any);

    const widget = catalog.components.get('Widget');
    assert.ok(widget);
    const shape = (widget.schema as z.ZodObject<any>).shape;
    assert.deepStrictEqual(Object.keys(shape), ['label']);
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

    const catalog = Catalog.fromSchema(customCatalog, '0.9');
    const btn = catalog.components.get('CustomButton');
    assert.ok(btn);

    const shape = (btn.schema as z.ZodObject<any>).shape;
    // Protocol accessibility is present
    assert.ok(shape.accessibility);
    assert.ok(shape.label);
    // weight is NOT present in custom catalog without CatalogComponentCommon
    assert.strictEqual(shape.weight, undefined);
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

    const catalog = Catalog.fromSchema(catalogWithEnums, '0.9');
    const widget = catalog.components.get('EnumWidget');
    assert.ok(widget);

    const valid = widget.schema.safeParse({numEnum: 2, singleEnum: 'only_one'});
    assert.strictEqual(valid.success, true);

    const invalid = widget.schema.safeParse({numEnum: 99});
    assert.strictEqual(invalid.success, false);
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

    const catalog = Catalog.fromSchema(catalogJson, '0.9');
    const comp = catalog.components.get('StrictNode');
    assert.ok(comp);
    assert.deepStrictEqual(comp.allowedParents, ['ParentValid']);
    assert.deepStrictEqual(comp.allowedChildren, ['ChildValid']);
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

    const catalog = Catalog.fromSchema(catalogJson, '0.9');
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

    const catalog = Catalog.fromSchema(catalogJson, '0.9');
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

    const catalog = Catalog.fromSchema(catalogJson, '0.9');
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

    const catalog = Catalog.fromSchema(catalogJson, '0.9');
    const inputComp = catalog.components.get('FlexibleInput');
    assert.ok(inputComp);

    assert.strictEqual(inputComp.schema.safeParse({value: 'hello'}).success, true);
    assert.strictEqual(inputComp.schema.safeParse({value: 42}).success, true);
    assert.strictEqual(inputComp.schema.safeParse({value: true}).success, true);
    assert.strictEqual(inputComp.schema.safeParse({value: {invalid: 'obj'}}).success, false);
  });

  it('applies passthrough on function argument schemas when unevaluatedProperties is true or a schema object', () => {
    const catalogJson = {
      catalogId: 'https://example.com/fn_uneval_props_catalog.json',
      functions: {
        openFn: {
          properties: {
            args: {
              type: 'object',
              properties: {
                target: {type: 'string'},
              },
              unevaluatedProperties: true,
            },
          },
        },
        schemaFn: {
          properties: {
            args: {
              type: 'object',
              properties: {
                target: {type: 'string'},
              },
              unevaluatedProperties: {type: 'number'},
            },
          },
        },
        strictFn: {
          properties: {
            args: {
              type: 'object',
              properties: {
                target: {type: 'string'},
              },
              unevaluatedProperties: false,
            },
          },
        },
      },
    };

    const catalog = Catalog.fromSchema(catalogJson, '0.9');
    const openFn = catalog.functions.get('openFn');
    const schemaFn = catalog.functions.get('schemaFn');
    const strictFn = catalog.functions.get('strictFn');

    assert.ok(openFn);
    assert.ok(schemaFn);
    assert.ok(strictFn);

    assert.strictEqual(openFn.schema.safeParse({target: 'A', extra: 'allowed'}).success, true);
    assert.strictEqual(schemaFn.schema.safeParse({target: 'B', extra: 123}).success, true);
    assert.strictEqual(strictFn.schema.safeParse({target: 'C', extra: 'rejected'}).success, false);
  });

  it('keeps nested child references from inline object array items', () => {
    const catalog = Catalog.fromSchema({
      catalogId: 'tabs-cat',
      protocolVersion: '0.9',
      components: {
        Tabs: {
          type: 'object',
          properties: {
            tabs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: {type: 'string'},
                  child: {$ref: '#/$defs/ComponentId'},
                },
              },
            },
          },
        },
      },
    });

    const refs = catalog.componentRefMap['Tabs'];
    assert.deepStrictEqual([...refs.listRefs], ['tabs']);
    assert.deepStrictEqual([...(refs.nestedRefs?.['tabs'] ?? [])], ['child']);

    // The item schema is structural rather than an opaque record, but still
    // tolerates keys the catalog did not declare.
    const schema = catalog.components.get('Tabs')!.schema;
    assert.ok(schema.safeParse({tabs: [{title: 'Overview', child: 'c1', extra: 1}]}).success);
    assert.ok(!schema.safeParse({tabs: [{title: 42}]}).success);
  });
});
