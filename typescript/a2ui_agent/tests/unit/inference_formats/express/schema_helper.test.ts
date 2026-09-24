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

import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {describe, it, expect} from 'vitest';
import {Catalog} from '../../../../src/internal/web_core.js';
import {basicCatalog} from '../../../../src/types.js';
import {registerCatalogDocument} from '../../../../src/utils/catalog_document.js';
import {
  CatalogSchemaHelper,
  commonDefName,
  isActionSlot,
  expectsOptionObjects,
} from '../../../../src/inference_formats/express/schema_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

interface OracleHelperFixture {
  component_properties: Record<string, string[]>;
  component_required: Record<string, string[]>;
  component_is_checkable: Record<string, boolean>;
  component_property_enums: Record<string, string[]>;
  function_properties: Record<string, string[]>;
  function_required: Record<string, string[]>;
}

describe('CatalogSchemaHelper and Express schema utilities', () => {
  describe('1. Property-order regression test (plan §4, permanent)', () => {
    // Fixture provenance and regeneration: see fixtures/README.md.
    it('matches Python oracle for v1.0 basic catalog', () => {
      const v10FixturePath = path.join(FIXTURES_DIR, 'basic_v1_0_helper.json');
      const expected = JSON.parse(fs.readFileSync(v10FixturePath, 'utf8')) as OracleHelperFixture;

      const cat = basicCatalog('v1.0');
      const helper = new CatalogSchemaHelper(cat, 'v1.0');

      for (const [comp, props] of Object.entries(expected.component_properties)) {
        expect(helper.getComponentProperties(comp), `Component properties for ${comp}`).toEqual(
          props,
        );
        expect(helper.getComponentRequired(comp), `Component required for ${comp}`).toEqual(
          expected.component_required[comp],
        );
        expect(helper.isCheckable(comp), `isCheckable for ${comp}`).toBe(
          expected.component_is_checkable[comp],
        );
      }

      for (const [fn, props] of Object.entries(expected.function_properties)) {
        expect(helper.getFunctionProperties(fn), `Function properties for ${fn}`).toEqual(props);
        expect(helper.getFunctionRequired(fn), `Function required for ${fn}`).toEqual(
          expected.function_required[fn],
        );
      }

      for (const [key, allowed] of Object.entries(expected.component_property_enums)) {
        const [comp, prop] = key.split('.');
        expect(helper.getPropertyEnum(comp, prop), `Property enum for ${key}`).toEqual(allowed);
      }
    });

    // Fixture provenance and regeneration: see fixtures/README.md.
    it('matches Python oracle for v0.9 basic catalog', () => {
      const v09FixturePath = path.join(FIXTURES_DIR, 'basic_v0_9_helper.json');
      const expected = JSON.parse(fs.readFileSync(v09FixturePath, 'utf8')) as OracleHelperFixture;

      const cat = basicCatalog('v0.9');
      const helper = new CatalogSchemaHelper(cat, 'v0.9');

      for (const [comp, props] of Object.entries(expected.component_properties)) {
        expect(helper.getComponentProperties(comp), `Component properties for ${comp}`).toEqual(
          props,
        );
        expect(helper.getComponentRequired(comp), `Component required for ${comp}`).toEqual(
          expected.component_required[comp],
        );
        expect(helper.isCheckable(comp), `isCheckable for ${comp}`).toBe(
          expected.component_is_checkable[comp],
        );
      }

      for (const [fn, props] of Object.entries(expected.function_properties)) {
        expect(helper.getFunctionProperties(fn), `Function properties for ${fn}`).toEqual(props);
        expect(helper.getFunctionRequired(fn), `Function required for ${fn}`).toEqual(
          expected.function_required[fn],
        );
      }

      for (const [key, allowed] of Object.entries(expected.component_property_enums)) {
        const [comp, prop] = key.split('.');
        expect(helper.getPropertyEnum(comp, prop), `Property enum for ${key}`).toEqual(allowed);
      }
    });
  });

  describe('2. Forms-style inline catalog', () => {
    it('correctly discovers own check-rule property and retains declared order', () => {
      const formsFixturePath = path.join(FIXTURES_DIR, 'forms_catalog_v1_0.json');
      const formsDoc = JSON.parse(fs.readFileSync(formsFixturePath, 'utf8')) as Record<
        string,
        unknown
      >;

      const formsCat = Catalog.fromSchema(formsDoc);
      registerCatalogDocument(formsCat, formsDoc);

      const helper = new CatalogSchemaHelper(formsCat, 'v1.0');

      expect(helper.getComponentProperties('TextField')).toEqual([
        'label',
        'value',
        'placeholder',
        'checks',
      ]);
      expect(helper.getCheckRuleProperty('TextField')).toBe('checks');
      expect(helper.isCheckable('TextField')).toBe(true);
    });
  });

  describe('3. isActionSlot', () => {
    it('is true only for Button.action in both v1.0 and v0.9 basic catalogs', () => {
      for (const version of ['v1.0', 'v0.9'] as const) {
        const cat = basicCatalog(version);
        const helper = new CatalogSchemaHelper(cat, version);

        for (const compName of helper.components.keys()) {
          for (const propName of helper.getComponentProperties(compName)) {
            const schema = helper.getPropertySchema(compName, propName);
            if (compName === 'Button' && propName === 'action') {
              expect(
                isActionSlot(schema),
                `Button.action in ${version} should be action slot`,
              ).toBe(true);
            } else {
              expect(
                isActionSlot(schema),
                `${compName}.${propName} in ${version} should not be action slot`,
              ).toBe(false);
            }
          }
        }
      }
    });
  });

  describe('4. admitsPath against express_catalog_instructions.txt (static) labels', () => {
    it('reproduces golden (static) labels for all 75 properties (51 static, 24 non-static)', () => {
      const instructionsPath =
        '/work/google/a2ui/conformance/test_data/skills/express_catalog_instructions.txt';
      const content = fs.readFileSync(instructionsPath, 'utf8');

      const cat = basicCatalog('v1.0');
      const helper = new CatalogSchemaHelper(cat, 'v1.0');

      let staticCount = 0;
      let nonStaticCount = 0;

      const lines = content.split('\n');
      for (const line of lines) {
        const match = /^•\s+(\w+)\((.*)\)$/.exec(line.trim());
        if (!match) {
          continue;
        }
        const compName = match[1];
        if (!helper.components.has(compName)) {
          continue;
        }

        const argsStr = match[2];
        const argParts = argsStr.split(',').map(s => s.trim());

        for (const argPart of argParts) {
          const isExpectedStatic = argPart.includes('(static)');
          const cleanName = argPart
            .replace(/\?/g, '')
            .replace(/\(static\)/g, '')
            .trim();

          const schema =
            cleanName === 'checks'
              ? helper.getCheckRulePropertySchema(compName)
              : helper.getPropertySchema(compName, cleanName);

          expect(schema, `Schema for ${compName}.${cleanName}`).toBeDefined();

          const admits = helper.admitsPath(schema);
          const actualStatic = !admits;

          expect(
            actualStatic,
            `Expected ${compName}.${cleanName} to be static: ${isExpectedStatic}`,
          ).toBe(isExpectedStatic);

          if (actualStatic) {
            staticCount++;
          } else {
            nonStaticCount++;
          }
        }
      }

      expect(staticCount).toBe(51);
      expect(nonStaticCount).toBe(24);
      expect(staticCount + nonStaticCount).toBe(75);
    });
  });

  describe('5. commonDefName', () => {
    it('recognizes absolute v0.9 URL and relative v1.0 form, rejecting local and non-string', () => {
      expect(
        commonDefName('https://a2ui.org/specification/v0_9/common_types.json#/$defs/Action'),
      ).toBe('Action');
      expect(
        commonDefName('https://a2ui.org/specification/v0_9/common_types.json#/$defs/CheckRule'),
      ).toBe('CheckRule');
      expect(commonDefName('common_types.json#/$defs/DynamicString')).toBe('DynamicString');
      expect(commonDefName('common_types.json#/$defs/DataBinding')).toBe('DataBinding');

      expect(commonDefName('#/$defs/MyDynamicString')).toBeUndefined();
      expect(commonDefName('#/definitions/MyThing')).toBeUndefined();
      expect(commonDefName('other_schema.json#/$defs/Action')).toBeUndefined();

      expect(commonDefName(123)).toBeUndefined();
      expect(commonDefName(null)).toBeUndefined();
      expect(commonDefName(undefined)).toBeUndefined();
      expect(commonDefName({})).toBeUndefined();
    });
  });

  describe('6. Catalog-local def negative test', () => {
    it('does not treat catalog-local MyAction or DynamicFoo as Action or admitting path unless having path', () => {
      const mockDoc: Record<string, unknown> = {
        catalogId: 'test_negative',
        protocolVersion: '1.0',
        components: {
          CustomComp: {
            type: 'object',
            properties: {
              component: {const: 'CustomComp'},
              actionSlot: {$ref: '#/$defs/MyAction'},
              dynamicFoo: {$ref: '#/$defs/DynamicFoo'},
              withPath: {$ref: '#/$defs/WithPath'},
            },
          },
        },
        functions: {},
        $defs: {
          MyAction: {
            type: 'object',
            properties: {
              event: {type: 'string'},
            },
          },
          DynamicFoo: {
            type: 'object',
            properties: {
              value: {type: 'string'},
            },
          },
          WithPath: {
            type: 'object',
            properties: {
              path: {type: 'string'},
            },
          },
        },
      };

      const customCat = Catalog.fromSchema(mockDoc);
      registerCatalogDocument(customCat, mockDoc);
      const helper = new CatalogSchemaHelper(customCat, 'v1.0');

      const actionSlotSchema = helper.getPropertySchema('CustomComp', 'actionSlot');
      expect(isActionSlot(actionSlotSchema)).toBe(false);
      expect(helper.admitsPath(actionSlotSchema)).toBe(false);

      const dynamicFooSchema = helper.getPropertySchema('CustomComp', 'dynamicFoo');
      expect(isActionSlot(dynamicFooSchema)).toBe(false);
      expect(helper.admitsPath(dynamicFooSchema)).toBe(false);

      const withPathSchema = helper.getPropertySchema('CustomComp', 'withPath');
      expect(helper.admitsPath(withPathSchema)).toBe(true);
    });
  });

  describe('expectsOptionObjects (sanctioned exception plan §5.2 item 2)', () => {
    it('returns true when schema expects array of objects with label and value', () => {
      const schemaWithOptionObjects = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {type: 'string'},
            value: {type: 'string'},
          },
        },
      };
      expect(expectsOptionObjects(schemaWithOptionObjects)).toBe(true);

      const schemaWithOnlyLabel = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {type: 'string'},
          },
        },
      };
      expect(expectsOptionObjects(schemaWithOnlyLabel)).toBe(false);

      expect(expectsOptionObjects(null)).toBe(false);
      expect(expectsOptionObjects('string')).toBe(false);
    });
  });

  describe('helper general methods', () => {
    it('retrieves descriptions and property schemas', () => {
      const cat = basicCatalog('v1.0');
      const helper = new CatalogSchemaHelper(cat, 'v1.0');

      expect(helper.getComponentDescription('Column')).toBeDefined();
      expect(helper.getComponentDescription('Text')).toBeUndefined();
      expect(helper.getFunctionDescription('required')).toBeDefined();

      const textPropSchema = helper.getPropertySchema('Text', 'text');
      expect(textPropSchema).toBeDefined();

      const fnArgSchema = helper.getFunctionPropertySchema('regex', 'pattern');
      expect(fnArgSchema).toBeDefined();
      expect(fnArgSchema?.type).toBe('string');
    });

    it('resolves subschema for array items and object properties', () => {
      const cat = basicCatalog('v1.0');
      const helper = new CatalogSchemaHelper(cat, 'v1.0');

      const tabsSchema = helper.getPropertySchema('Tabs', 'tabs');
      expect(tabsSchema).toBeDefined();

      const itemsSchema = helper.resolveSubschema(tabsSchema, 'items');
      expect(itemsSchema).toBeDefined();

      const titleSchema = helper.resolveSubschema(itemsSchema, 'title');
      expect(titleSchema).toBeDefined();
      expect(helper.admitsPath(titleSchema)).toBe(true);

      const childSchema = helper.resolveSubschema(itemsSchema, 'child');
      expect(childSchema).toBeDefined();
      expect(helper.admitsPath(childSchema)).toBe(false);

      expect(helper.resolveSubschema(null, 'items')).toBeUndefined();
      expect(helper.resolveSubschema({}, 'nonexistent')).toBeUndefined();
    });
  });
});
