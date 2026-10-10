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

import {describe, expect, it} from 'vitest';

import {
  CatalogSchemaHelper,
  commonDefName,
  expectsOptionObjects,
  isActionSlot,
} from '../../../../src/inference-formats/express/schema-helper.js';
import {Catalog} from '../../../../src/internal/web-core.js';
import {
  getCatalogDocument,
  registerCatalogDocument,
} from '../../../../src/utils/catalog-document.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {loadConformanceCatalog} from '../../../helpers/conformance-catalogs.js';

const basicCatalogV10 = loadBasicCatalog('v1.0');
const basicCatalogV09 = loadBasicCatalog('v0.9');
const basicCatalogs = {'v1.0': basicCatalogV10, 'v0.9': basicCatalogV09};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');

type Schema = Record<string, unknown>;

/** The `$defs` of a protocol version's common types, as published in the specification. */
function readCommonDefs(specDir: 'v0_9' | 'v1_0'): Record<string, Schema> {
  const file = path.join(REPO_ROOT, 'specification', specDir, 'json/common_types.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).$defs;
}

function resolvePointer(doc: Schema, pointer: string): Schema {
  return pointer
    .slice(2)
    .split('/')
    .reduce<Schema>((node, part) => node[part] as Schema, doc);
}

function isCheckRuleList(schema: unknown): boolean {
  const s = schema as Schema;
  const ref = (s.items as Schema | undefined)?.$ref;
  return s.type === 'array' && typeof ref === 'string' && ref.endsWith('/CheckRule');
}

/** The enum a property declares, directly or in a `oneOf`/`anyOf`/`allOf` member. */
function findEnum(schema: Schema): unknown[] | undefined {
  if (Array.isArray(schema.enum)) {
    return schema.enum;
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    for (const member of (schema[key] ?? []) as Schema[]) {
      const values = findEnum(member);
      if (values) {
        return values;
      }
    }
  }
  return undefined;
}

/**
 * Splits what a component or function schema declares into the schemas that contribute its
 * own properties and the common types it references.
 *
 * Own properties come from the schema itself and its inline `allOf` members, in declared
 * order, then from `allOf` members that are local `#/...` references. The v0.9 basic catalog
 * uses one of those, `#/$defs/CatalogComponentCommon`, to add `weight`, which therefore comes
 * after the component's own properties, where v1.0 declares it inline.
 */
function declaredSchemas(doc: Schema, schema: Schema): {own: Schema[]; common: string[]} {
  const allOf = (schema.allOf ?? []) as Schema[];
  const refOf = (member: Schema) => (typeof member.$ref === 'string' ? member.$ref : undefined);
  const local = allOf.filter(m => refOf(m)?.startsWith('#/'));
  const common = allOf.filter(m => refOf(m) && !refOf(m)!.startsWith('#/'));
  return {
    own: [
      schema,
      ...allOf.filter(m => !refOf(m)),
      ...local.map(m => resolvePointer(doc, refOf(m)!)),
    ],
    common: common.map(m => refOf(m)!.split('#/$defs/')[1]),
  };
}

/**
 * What the catalog JSON declares for a component.
 *
 * A reference into the common types adds only a check-rule list, after every own property:
 * the common `Checkable` adds `checks`. Other common properties, such as `accessibility` from
 * `ComponentCommon`, are not Express arguments, and neither are `component` and `id`.
 */
function declaredComponent(doc: Schema, commonDefs: Record<string, Schema>, name: string) {
  const {own, common} = declaredSchemas(doc, (doc.components as Record<string, Schema>)[name]);
  const ownProperties = own.map(s => (s.properties ?? {}) as Record<string, Schema>);
  const commonCheckLists = common.flatMap(defName =>
    Object.entries((commonDefs[defName]?.properties ?? {}) as Record<string, Schema>)
      .filter(([, prop]) => isCheckRuleList(prop))
      .map(([propName]) => propName),
  );
  const properties = [
    ...new Set([
      ...ownProperties.flatMap(Object.keys).filter(k => k !== 'component' && k !== 'id'),
      ...commonCheckLists,
    ]),
  ];
  const enums = new Map<string, unknown>();
  for (const props of ownProperties) {
    for (const [propName, prop] of Object.entries(props)) {
      const values = findEnum(prop);
      if (values) {
        enums.set(propName, values);
      }
    }
  }
  const ownCheckLists = ownProperties.flatMap(props =>
    Object.keys(props).filter(k => isCheckRuleList(props[k])),
  );
  return {
    properties,
    required: own.flatMap(s => (s.required ?? []) as string[]),
    checkable: ownCheckLists.length + commonCheckLists.length > 0,
    enums,
  };
}

/** What the catalog JSON declares for the arguments of a function. */
function declaredFunction(doc: Schema, name: string) {
  const {own} = declaredSchemas(doc, (doc.functions as Record<string, Schema>)[name]);
  const args = own.map(s => ((s.properties ?? {}) as Record<string, Schema>).args ?? {});
  return {
    properties: args.flatMap(a => Object.keys(a.properties ?? {})),
    required: args.flatMap(a => (a.required ?? []) as string[]),
  };
}

describe('CatalogSchemaHelper and Express schema utilities', () => {
  describe.each([
    {version: 'v1.0' as const, specDir: 'v1_0' as const},
    {version: 'v0.9' as const, specDir: 'v0_9' as const},
  ])('reads the $version basic catalog as its JSON declares it', ({version, specDir}) => {
    const catalog = basicCatalogs[version];
    const doc = getCatalogDocument(catalog);
    const commonDefs = readCommonDefs(specDir);
    const helper = new CatalogSchemaHelper(catalog, version);
    const componentNames = Object.keys(doc.components as Schema);
    const functionNames = Object.keys(doc.functions as Schema);

    it('knows every component and function of the catalog', () => {
      expect([...helper.components.keys()]).toEqual(componentNames);
      expect([...helper.functions.keys()]).toEqual(functionNames);
    });

    it.each(componentNames)('component %s', name => {
      const declared = declaredComponent(doc, commonDefs, name);
      expect(helper.getComponentProperties(name)).toEqual(declared.properties);
      expect(helper.getComponentRequired(name)).toEqual(declared.required);
      expect(helper.isCheckable(name)).toBe(declared.checkable);
      for (const prop of declared.properties) {
        expect(helper.getPropertyEnum(name, prop), `enum of ${name}.${prop}`).toEqual(
          declared.enums.get(prop),
        );
      }
    });

    it.each(functionNames)('function %s', name => {
      const declared = declaredFunction(doc, name);
      expect(helper.getFunctionProperties(name)).toEqual(declared.properties);
      expect(helper.getFunctionRequired(name)).toEqual(declared.required);
    });
  });

  describe('properties that come from referenced definitions', () => {
    const helperV10 = new CatalogSchemaHelper(basicCatalogV10, 'v1.0');
    const helperV09 = new CatalogSchemaHelper(basicCatalogV09, 'v0.9');

    it('places weight from the local CatalogComponentCommon where v1.0 declares it inline', () => {
      // v1.0 declares `weight` last in each component's own properties; v0.9 brings it in
      // through `allOf: [{$ref: '#/$defs/CatalogComponentCommon'}]`. Both read the same.
      expect(helperV09.getComponentProperties('Text')).toEqual(['text', 'variant', 'weight']);
      expect(helperV10.getComponentProperties('Text')).toEqual(['text', 'variant', 'weight']);
    });

    it('appends checks from the common Checkable last', () => {
      for (const helper of [helperV10, helperV09]) {
        expect(helper.getComponentProperties('Button')).toEqual([
          'child',
          'variant',
          'action',
          'weight',
          'checks',
        ]);
        expect(helper.getCheckRuleProperty('Button')).toBe('checks');
        expect(helper.isCheckable('Text')).toBe(false);
      }
    });

    it('does not list accessibility from the common ComponentCommon', () => {
      expect(helperV09.getComponentProperties('Image')).not.toContain('accessibility');
      expect(helperV09.getComponentRequired('Image')).toEqual(['component', 'url']);
    });
  });

  describe('2. Forms-style inline catalog', () => {
    it('correctly discovers own check-rule property and retains declared order', () => {
      const formsCat = loadConformanceCatalog('forms_catalog_v1_0.json');

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
        const cat = basicCatalogs[version];
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
      const instructionsPath = path.resolve(
        __dirname,
        '../../../../../../conformance/test_data/skills/express_catalog_instructions.txt',
      );
      const content = fs.readFileSync(instructionsPath, 'utf8');

      const cat = basicCatalogV10;
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
      expect(commonDefName('common_types.json#/definitions/Action')).toBe('Action');

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

      const customCat = Catalog.fromJson(mockDoc);
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
      const cat = basicCatalogV10;
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
      const cat = basicCatalogV10;
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

    it('reads v0.9.1 schemas with the v0.9 common types', async () => {
      const catalogV091 = loadBasicCatalog('v0.9.1');
      const helper = new CatalogSchemaHelper(catalogV091, 'v0.9.1');
      const helperV09 = new CatalogSchemaHelper(basicCatalogV09, 'v0.9');
      expect(helper.commonTypes).toEqual(helperV09.commonTypes);
      expect(helper.getComponentProperties('Text')).toEqual(
        helperV09.getComponentProperties('Text'),
      );
    });
  });
});
