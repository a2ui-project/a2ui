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

import {
  a2uiType,
  allowedReturnTypesForDefinition,
  buildModelReferenceMap,
  CATALOG_DOCUMENT_FORMAT_VERSION,
  coerceModelDynamicBooleans,
  componentDefinitionToJsonSchema,
  defineCatalog,
  defineComponent,
  defineFunction,
  defineSurfaceProperties,
  definitionEnvelopeLayout,
  definitionToBehavior,
  extractDefinitionRefFields,
  findDynamicBooleanParamNames,
  functionDefinitionToJsonSchema,
  functionReturnTypeName,
  getFunctionDefinitionParameterNames,
  isCatalogDocument,
  isComponentDefinition,
  isDataBindingValue,
  isFunctionCallValue,
  jsonSchemaToModel,
  modelToJsonSchema,
  parseCatalogDocument,
  serializeCatalogDocument,
  t,
  validateCatalogValue,
  validateComponentProperties,
  validateFunctionArguments,
  validateSurfaceProperties,
  type DataTypeDefinition,
  type ModelValidationResult,
  type ResolveDefinitionProps,
  type ResolveFunctionDefinitionArgs,
} from './index.js';
import {A2uiCatalogError} from '../../errors.js';

describe('Canonical zero-dependency CatalogModel', () => {
  it('authors a typed catalog purely with builders and preserves compile-time literal inference', () => {
    const BadgeDef = defineComponent({
      name: 'Badge',
      description: 'Status badge with dynamic label and optional trailing child.',
      checkable: true,
      allowedParents: ['Row', 'Column', 'Surface'],
      allowedChildren: ['Icon'],
      parameters: [
        t.param('label', t.string({dynamic: true, minLength: 1}), {required: true}),
        t.param('tone', t.enum(['info', 'warning', 'error'], {default: 'info'})),
        t.param('count', t.integer({min: 0, max: 99, dynamic: true})),
        t.param('leading', t.child()),
        t.param('actions', t.childList()),
        t.param('onTap', t.action()),
      ],
    });

    const ClampFnDef = defineFunction({
      name: 'clamp',
      description: 'Clamps a number between optional bounds.',
      returnType: 'number',
      parameters: [
        t.param('value', t.number(), {required: true}),
        t.param('min', t.number()),
        t.param('max', t.number()),
      ],
      atLeastOneOf: [['min', 'max']],
    });

    const SurfacePropsDef = defineSurfaceProperties({
      description: 'Theme configuration.',
      properties: [
        t.param('primaryColor', t.string({pattern: '^#[0-9a-fA-F]{6}$'})),
        t.param('density', t.enum(['compact', 'comfortable'])),
      ],
    });

    const catalogModel = defineCatalog({
      catalogId: 'https://example.com/catalogs/badges/v1',
      protocolVersion: '1.0',
      title: 'Badge Catalog',
      types: {
        Weight: a2uiType.number({min: 0, description: 'Flex weight.'}),
      },
      surfaceProperties: SurfacePropsDef,
      components: [BadgeDef],
      functions: [ClampFnDef],
    });

    assert.strictEqual(catalogModel.formatVersion, CATALOG_DOCUMENT_FORMAT_VERSION);
    assert.strictEqual(catalogModel.components?.length, 1);
    assert.strictEqual(catalogModel.functions?.length, 1);

    // Compile-time type assertions verifying literal inference without Zod.
    type BadgeProps = ResolveDefinitionProps<typeof BadgeDef>;
    const sampleBadgeProps: BadgeProps = {
      label: 'Active',
      tone: 'warning',
      count: 3,
      leading: 'icon-1',
      actions: [{id: 'btn-1', basePath: '/'}],
      onTap: async () => {},
      setLabel: (_v: string) => {},
      setCount: (_v: number) => {},
      isValid: true,
      validationErrors: [],
    };
    assert.strictEqual(sampleBadgeProps.label, 'Active');
    assert.strictEqual(sampleBadgeProps.tone, 'warning');

    type ClampArgs = ResolveFunctionDefinitionArgs<typeof ClampFnDef>;
    const sampleClampArgs: ClampArgs = {value: 10, min: 0, max: 5};
    assert.strictEqual(sampleClampArgs.value, 10);
  });

  describe('Catalog Document parsing and serialization rules', () => {
    const validDoc = {
      formatVersion: '1.0',
      catalogId: 'https://example.com/cat/v1',
      protocolVersion: '1.0',
      title: 'Test Catalog',
      types: {
        Weight: {type: 'number', min: 0},
      },
      surfaceProperties: {
        properties: [{name: 'accent', type: 'string'}],
      },
      components: [
        {
          name: 'Card',
          description: 'A card container.',
          parameters: [
            {name: 'title', type: 'string', dynamic: true, required: true},
            {name: 'weight', type: 'ref', ref: 'Weight'},
            {name: 'body', type: 'child', required: true},
          ],
        },
      ],
      functions: [
        {
          name: 'openDoc',
          returnType: 'void',
          allowedCallers: 'rendererOnly',
          requiresUserActivation: true,
          parameters: [{name: 'url', type: 'string', format: 'uri', required: true}],
        },
      ],
    };

    it('detects Catalog Documents via isCatalogDocument', () => {
      assert.strictEqual(isCatalogDocument(validDoc), true);
      assert.strictEqual(isCatalogDocument({catalogId: 'legacy', components: {}}), false);
      assert.strictEqual(isCatalogDocument(null), false);
      assert.strictEqual(isCatalogDocument([]), false);
    });

    it('round-trips a valid Catalog Document losslessly', () => {
      const model = parseCatalogDocument(validDoc);
      const serialized = serializeCatalogDocument(model);
      const reparsed = parseCatalogDocument(serialized);
      assert.deepStrictEqual(reparsed, model);
      assert.strictEqual(serialized['formatVersion'], '1.0');
    });

    it('rejects unsupported formatVersion values', () => {
      assert.throws(
        () => parseCatalogDocument({...validDoc, formatVersion: '2.0'}),
        err => err instanceof A2uiCatalogError && /formatVersion/.test(err.message),
      );
      assert.throws(
        () => parseCatalogDocument({...validDoc, formatVersion: '0.9'}),
        err => err instanceof A2uiCatalogError && /formatVersion/.test(err.message),
      );
    });

    it('rejects reserved component name Surface and invalid UAX #31 identifiers', () => {
      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/bad',
            components: [{name: 'Surface'}],
          }),
        err => err instanceof A2uiCatalogError && /Surface/.test(err.message),
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/bad',
            components: [{name: '123Invalid'}],
          }),
        err => err instanceof A2uiCatalogError && /UAX #31/.test(err.message),
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/bad',
            components: [{name: 'Card', parameters: [{name: 'bad-param', type: 'string'}]}],
          }),
        err => err instanceof A2uiCatalogError && /UAX #31/.test(err.message),
      );
    });

    it('rejects forbidden envelope parameter names on components', () => {
      for (const forbidden of [
        'id',
        'component',
        '@metadata',
        '@catalogId',
        '@accessibility',
        '@checks',
      ]) {
        assert.throws(
          () =>
            parseCatalogDocument({
              formatVersion: '1.0',
              catalogId: 'https://example.com/bad',
              components: [{name: 'Widget', parameters: [{name: forbidden, type: 'string'}]}],
            }),
          A2uiCatalogError,
          `expected '${forbidden}' to be rejected`,
        );
      }
    });

    it('enforces requiresUserActivation compatibility with allowedCallers', () => {
      for (const disallowed of ['agentOnly', 'rendererOrAgent']) {
        assert.throws(
          () =>
            parseCatalogDocument({
              formatVersion: '1.0',
              catalogId: 'https://example.com/bad',
              functions: [
                {
                  name: 'risky',
                  returnType: 'void',
                  allowedCallers: disallowed,
                  requiresUserActivation: true,
                },
              ],
            }),
          err => err instanceof A2uiCatalogError && /requiresUserActivation/.test(err.message),
        );
      }

      // Allowed with rendererOnly or omitted allowedCallers
      assert.doesNotThrow(() =>
        parseCatalogDocument({
          formatVersion: '1.0',
          catalogId: 'https://example.com/ok',
          functions: [
            {name: 'clickA', returnType: 'void', requiresUserActivation: true},
            {
              name: 'clickB',
              returnType: 'void',
              allowedCallers: 'rendererOnly',
              requiresUserActivation: true,
            },
          ],
        }),
      );
    });

    it('rejects duplicate names and unresolved local refs', () => {
      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/dup',
            components: [{name: 'Dup'}, {name: 'Dup'}],
          }),
        err => err instanceof A2uiCatalogError && /Duplicate component/.test(err.message),
      );

      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/dup',
            functions: [
              {name: 'dupFn', returnType: 'string'},
              {name: 'dupFn', returnType: 'number'},
            ],
          }),
        err => err instanceof A2uiCatalogError && /Duplicate function/.test(err.message),
      );

      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/ref',
            components: [
              {name: 'Box', parameters: [{name: 'w', type: 'ref', ref: 'DoesNotExist'}]},
            ],
          }),
        err =>
          err instanceof A2uiCatalogError &&
          /local type reference 'DoesNotExist'/.test(err.message),
      );
    });

    it('rejects component-only types inside functions, types, and surfaceProperties', () => {
      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/bad',
            functions: [
              {
                name: 'badFn',
                returnType: 'void',
                parameters: [{name: 'slot', type: 'child'}],
              },
            ],
          }),
        err => err instanceof A2uiCatalogError && /component-only type/i.test(err.message),
      );

      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/bad',
            types: {
              BadAlias: {type: 'action'},
            },
          }),
        err => err instanceof A2uiCatalogError && /component-only type/i.test(err.message),
      );

      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/bad',
            surfaceProperties: {
              properties: [{name: 'badSlot', type: 'childList'}],
            },
          }),
        err => err instanceof A2uiCatalogError && /component-only type/i.test(err.message),
      );
    });

    it('forbids rawJsonSchema in serialized Catalog Documents', () => {
      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/bad',
            components: [
              {
                name: 'Raw',
                parameters: [{name: 'x', type: 'rawJsonSchema', schema: {type: 'string'}}],
              },
            ],
          }),
        A2uiCatalogError,
      );

      assert.throws(
        () =>
          serializeCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/bad',
            components: [
              {
                name: 'Raw',
                parameters: [{name: 'x', type: 'rawJsonSchema', schema: {type: 'string'}}],
              },
            ],
          }),
        err => err instanceof A2uiCatalogError && /rawJsonSchema/.test(err.message),
      );
    });

    it('rejects atLeastOneOf referencing an undeclared parameter', () => {
      assert.throws(
        () =>
          parseCatalogDocument({
            formatVersion: '1.0',
            catalogId: 'https://example.com/bad',
            functions: [
              {
                name: 'range',
                returnType: 'boolean',
                parameters: [{name: 'min', type: 'number'}],
                atLeastOneOf: [['min', 'missingParam']],
              },
            ],
          }),
        err => err instanceof A2uiCatalogError && /atLeastOneOf/.test(err.message),
      );
    });
  });

  describe('Zero-dependency runtime validator (validateCatalogValue)', () => {
    it('validates dynamic bindings, bounds, patterns, formats, and defaults', () => {
      const def = defineComponent({
        name: 'Input',
        parameters: [
          t.param('label', t.string({dynamic: true, minLength: 2, maxLength: 20}), {
            required: true,
          }),
          t.param('email', t.string({format: 'email'})),
          t.param('when', t.string({dynamic: true, format: ['date', 'time', 'date-time']})),
          t.param('step', t.integer({min: 1, max: 10, default: 1})),
          t.param('tags', t.array(t.string(), {minItems: 1, maxItems: 3, uniqueItems: true})),
          t.param('mode', t.enum(['a', 'b'])),
        ],
      });

      const ok = validateComponentProperties(
        def,
        {
          label: {'@path': '/form/label'},
          email: 'ada@example.com',
          when: '2026-03-14T12:00:00Z',
          tags: ['one', 'two'],
          mode: 'a',
        },
        {protocolVersion: '1.0', applyDefaults: true},
      );
      assert.strictEqual(ok.success, true);
      if (ok.success) {
        assert.strictEqual(ok.data['step'], 1);
      }

      // Dynamic binding rejected on static parameter
      const badDynamicOnStatic = validateComponentProperties(
        def,
        {label: 'Name', email: {'@path': '/email'}},
        {protocolVersion: '1.0'},
      );
      assert.strictEqual(badDynamicOnStatic.success, false);

      // Invalid email format
      const badEmail = validateComponentProperties(
        def,
        {label: 'Name', email: 'not-an-email'},
        {protocolVersion: '1.0'},
      );
      assert.strictEqual(badEmail.success, false);

      // Duplicate items violate uniqueItems
      const badUnique = validateComponentProperties(
        def,
        {label: 'Name', tags: ['dup', 'dup']},
        {protocolVersion: '1.0'},
      );
      assert.strictEqual(badUnique.success, false);

      // Float rejected by integer
      const badInt = validateComponentProperties(
        def,
        {label: 'Name', step: 2.5},
        {protocolVersion: '1.0'},
      );
      assert.strictEqual(badInt.success, false);
    });

    it('enforces exclusive (oneOf) vs inclusive (anyOf) union semantics', () => {
      const exclusiveUnion = t.union([t.enum(['md', 'lg']), t.string()], {exclusive: true});
      // 'md' matches BOTH branches -> fails exclusive union
      assert.strictEqual(validateCatalogValue(exclusiveUnion, 'md').success, false);
      // '12px' matches only string -> passes exclusive union
      assert.strictEqual(validateCatalogValue(exclusiveUnion, '12px').success, true);

      const inclusiveUnion = t.union([t.enum(['md', 'lg']), t.string()], {exclusive: false});
      assert.strictEqual(validateCatalogValue(inclusiveUnion, 'md').success, true);
    });

    it('validates function arguments with atLeastOneOf and DynamicBoolean ValidationResult coercion', () => {
      const lengthFn = defineFunction({
        name: 'length',
        returnType: 'validationResult',
        parameters: [
          t.param('value', t.string({dynamic: true}), {required: true}),
          t.param('min', t.integer({min: 0})),
          t.param('max', t.integer({min: 0})),
        ],
        atLeastOneOf: [['min', 'max']],
      });

      assert.strictEqual(validateFunctionArguments(lengthFn, {value: 'hi', min: 1}).success, true);
      assert.strictEqual(validateFunctionArguments(lengthFn, {value: 'hi'}).success, false);

      const andFn = defineFunction({
        name: 'and',
        returnType: 'boolean',
        parameters: [t.param('values', t.array(t.boolean({dynamic: true})), {required: true})],
      });

      const coerced = validateFunctionArguments(
        andFn,
        {
          values: [
            {valid: true, message: 'ok', severity: 'error'},
            {valid: false, message: 'just a warning', severity: 'warning'},
            {valid: false, message: 'blocking error', severity: 'error'},
          ],
        },
        {protocolVersion: '1.0', coerceDynamicBoolean: true},
      );
      assert.strictEqual(coerced.success, true);
      if (coerced.success) {
        // ValidationResult objects coerce to their boolean `.valid` field.
        assert.deepStrictEqual(coerced.data['values'], [true, false, false]);
      }
    });

    it('validates surfaceProperties with additionalProperties semantics', () => {
      const sp = defineSurfaceProperties({
        properties: [t.param('primaryColor', t.string({pattern: '^#[0-9a-fA-F]{6}$'}))],
        additionalProperties: false,
      });
      assert.strictEqual(validateSurfaceProperties(sp, {primaryColor: '#112233'}).success, true);
      assert.strictEqual(validateSurfaceProperties(sp, {primaryColor: 'red'}).success, false);
      assert.strictEqual(
        validateSurfaceProperties(sp, {primaryColor: '#112233', unknown: true}).success,
        false,
      );
    });
  });

  describe('Direct zero-dep semantic helpers', () => {
    it('derives GenericBinder BehaviorNode, RefFields, EnvelopeLayout, and ReturnTypes directly', () => {
      const tabsDef = defineComponent({
        name: 'Tabs',
        checkable: true,
        parameters: [
          t.param('header', t.child()),
          t.param('children', t.childList()),
          t.param('onChange', t.action()),
          t.param('disabled', t.boolean({dynamic: true})),
          t.param('metadata', t.string({dynamic: true})), // custom bare 'metadata' property!
          t.param(
            'tabs',
            t.array(
              t.object([
                t.param('title', t.string({dynamic: true}), {required: true}),
                t.param('panel', t.child(), {required: true}),
              ]),
            ),
          ),
        ],
      });

      const behavior = definitionToBehavior(tabsDef);
      assert.strictEqual(behavior.type, 'OBJECT');
      if (behavior.type === 'OBJECT') {
        assert.deepStrictEqual(behavior.shape['header'], {type: 'STATIC'});
        assert.deepStrictEqual(behavior.shape['children'], {type: 'STRUCTURAL'});
        assert.deepStrictEqual(behavior.shape['onChange'], {type: 'ACTION'});
        assert.deepStrictEqual(behavior.shape['disabled'], {type: 'DYNAMIC', isBoolean: true});
        assert.deepStrictEqual(behavior.shape['@checks'], {type: 'CHECKABLE'});
        assert.deepStrictEqual(behavior.shape['checks'], {type: 'CHECKABLE'});
        assert.strictEqual(behavior.shape['tabs'].type, 'ARRAY');
      }

      const refFields = extractDefinitionRefFields(tabsDef);
      assert.deepStrictEqual(refFields.get('header'), {kind: 'single'});
      assert.deepStrictEqual(refFields.get('children'), {kind: 'list'});
      const tabsRef = refFields.get('tabs');
      assert.ok(tabsRef && tabsRef.kind === 'nested');
      assert.deepStrictEqual([...tabsRef.keys], ['panel']);

      const refMap = buildModelReferenceMap([tabsDef]);
      assert.deepStrictEqual([...refMap['Tabs'].singleRefs], ['header']);
      assert.deepStrictEqual([...refMap['Tabs'].listRefs].sort(), ['children', 'tabs']);
      assert.deepStrictEqual([...(refMap['Tabs'].nestedRefs?.['tabs'] ?? [])], ['panel']);

      const layout = definitionEnvelopeLayout(tabsDef);
      assert.strictEqual(layout.customKeys.has('metadata'), true);
      assert.strictEqual(layout.customKeys.has('checks'), false);
      assert.strictEqual(layout.schemaKeys.get('checks'), '@checks');

      const fnDef = defineFunction({
        name: 'gate',
        returnType: 'boolean',
        parameters: [
          t.param('flag', t.boolean({dynamic: true}), {required: true}),
          t.param('label', t.string({dynamic: true})),
        ],
      });
      assert.deepStrictEqual([...findDynamicBooleanParamNames(fnDef)], ['flag']);
      assert.deepStrictEqual(
        [...(getFunctionDefinitionParameterNames(fnDef) ?? [])],
        ['flag', 'label'],
      );
      assert.deepStrictEqual(
        [...(allowedReturnTypesForDefinition(t.string({dynamic: true})) ?? [])],
        ['string'],
      );
      assert.deepStrictEqual(
        [...(allowedReturnTypesForDefinition(t.boolean({dynamic: true})) ?? [])],
        ['boolean'],
      );
      assert.strictEqual(allowedReturnTypesForDefinition(t.any({dynamic: true})), undefined);
    });
  });

  describe('Refinement regression tests (cycles, strict formats, codec, and type inference)', () => {
    it('handles cyclic structural refs across all semantic helpers without stack overflow', () => {
      const cyclicTypes: Record<string, DataTypeDefinition> = {
        Node: t.object([
          t.param('label', t.string({dynamic: true}), {required: true}),
          t.param('enabled', t.boolean({dynamic: true})),
          t.param('next', t.ref('Node')),
        ]),
        RecArr: t.array(t.ref('RecArr')),
        ArrObj: t.array(t.object([t.param('nested', t.ref('ArrObj'))])),
        RecU: t.union([t.ref('RecU'), t.string({dynamic: true})]),
        NonExclU: t.union(
          [t.ref('NonExclU'), t.object([t.param('a', t.string())], {dynamic: true})],
          {exclusive: false},
        ),
      };

      const treeComp = defineComponent({
        name: 'Tree',
        parameters: [
          t.param('root', t.ref('Node'), {required: true}),
          t.param('matrix', t.ref('RecArr')),
          t.param('nestedList', t.ref('ArrObj')),
          t.param('recUnion', t.ref('RecU')),
          t.param('openUnion', t.ref('NonExclU')),
        ],
      });

      const behavior = definitionToBehavior(treeComp, cyclicTypes);
      assert.strictEqual(behavior.type, 'OBJECT');
      if (behavior.type === 'OBJECT') {
        assert.strictEqual(behavior.shape['root'].type, 'OBJECT');
        if (behavior.shape['root'].type === 'OBJECT') {
          assert.deepStrictEqual(behavior.shape['root'].shape['label'], {
            type: 'DYNAMIC',
          });
          assert.deepStrictEqual(behavior.shape['root'].shape['enabled'], {
            type: 'DYNAMIC',
            isBoolean: true,
          });
        }
      }

      const refs = extractDefinitionRefFields(treeComp, cyclicTypes);
      assert.strictEqual(refs.size, 0);
      assert.deepStrictEqual(buildModelReferenceMap([treeComp], cyclicTypes)['Tree'], {
        singleRefs: new Set(),
        listRefs: new Set(),
        nestedRefs: {},
      });

      const fnDef = defineFunction({
        name: 'walkNode',
        returnType: 'boolean',
        parameters: [t.param('node', t.ref('Node')), t.param('rec', t.ref('RecArr'))],
      });
      assert.deepStrictEqual([...findDynamicBooleanParamNames(fnDef, cyclicTypes)], ['node']);
      assert.deepStrictEqual(
        [...(allowedReturnTypesForDefinition(t.ref('RecU'), cyclicTypes) ?? [])],
        ['string'],
      );
      assert.deepStrictEqual(
        [...(allowedReturnTypesForDefinition(t.ref('NonExclU'), cyclicTypes) ?? [])],
        ['object'],
      );
    });

    it('validates and coerces recursive ref values at arbitrary depth and errors on unguarded cycles', () => {
      const types: Record<string, DataTypeDefinition> = {
        Node: t.object([
          t.param('label', t.string(), {required: true}),
          t.param('flag', t.boolean({dynamic: true})),
          t.param('next', t.ref('Node')),
        ]),
      };

      const validRes = validateCatalogValue(
        t.ref('Node'),
        {label: 'root', next: {label: 'child', next: {label: 'leaf'}}},
        {types},
      );
      assert.strictEqual(validRes.success, true);

      const invalidNested = validateCatalogValue(
        t.ref('Node'),
        {label: 'root', next: {label: 12345, bogusKey: true}},
        {types},
      );
      assert.strictEqual(invalidNested.success, false);
      if (!invalidNested.success) {
        assert.ok(
          invalidNested.issues.some(i => i.path.join('.') === 'next.label'),
          'expected error on nested next.label',
        );
        assert.ok(
          invalidNested.issues.some(i => i.code === 'unrecognized_keys'),
          'expected unrecognized_keys error on nested bogusKey',
        );
      }

      const fnDef = defineFunction({
        name: 'process',
        returnType: 'void',
        parameters: [
          t.param('node', t.ref('Node')),
          t.param('flagsMap', t.object([], {additionalProperties: t.boolean({dynamic: true})})),
          t.param('either', t.union([t.boolean({dynamic: true}), t.string()])),
        ],
      });
      const coerced = coerceModelDynamicBooleans(
        fnDef,
        {
          node: {
            label: 'root',
            flag: {valid: false, message: 'bad'},
            next: {label: 'child', flag: 'true'},
          },
          flagsMap: {a: {valid: true}, b: 0},
          either: {valid: false, message: 'nope'},
        },
        types,
      ) as Record<string, unknown>;
      assert.deepStrictEqual(coerced, {
        node: {
          label: 'root',
          flag: false,
          next: {label: 'child', flag: true},
        },
        flagsMap: {a: true, b: false},
        either: false,
      });

      // Unguarded alias cycle constructed programmatically must emit a real error,
      // never returning 0 issues (so union validation never false-positives).
      const cyclicAlias: Record<string, DataTypeDefinition> = {
        Loop: t.ref('Loop'),
      };
      const loopDirect = validateCatalogValue(t.ref('Loop'), 'anything', {types: cyclicAlias});
      assert.strictEqual(loopDirect.success, false);

      const loopInExclusiveUnion = validateCatalogValue(
        t.union([t.ref('Loop'), t.string()], {exclusive: true}),
        'hello',
        {types: cyclicAlias},
      );
      assert.strictEqual(loopInExclusiveUnion.success, true);

      const loopInUnionRejectsMismatch = validateCatalogValue(
        t.union([t.ref('Loop'), t.string()], {exclusive: false}),
        42,
        {types: cyclicAlias},
      );
      assert.strictEqual(loopInUnionRejectsMismatch.success, false);
    });

    it('enforces compile-time ResolveDefinitionProps and ResolveFunctionDefinitionArgs accuracy', () => {
      type AssertExact<A, B> =
        (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

      // Zero-parameter component must not collapse to Record<string, never>.
      const Divider = defineComponent({name: 'Divider'});
      type DividerProps = ResolveDefinitionProps<typeof Divider>;
      const okDivider: DividerProps = {accessibility: {label: 'Section break'}};
      const okDividerAt: DividerProps = {'@accessibility': {label: 'Section break'}};
      assert.ok(okDivider && okDividerAt);

      // Zero-parameter checkable component preserves CheckProps.
      const CheckOnly = defineComponent({name: 'CheckOnly', checkable: true});
      type CheckOnlyProps = ResolveDefinitionProps<typeof CheckOnly>;
      const assertCheckOnlyValid: AssertExact<CheckOnlyProps['isValid'], boolean | undefined> =
        true;
      const assertCheckOnlyErrors: AssertExact<
        CheckOnlyProps['validationErrors'],
        string[] | undefined
      > = true;
      const assertCheckOnlyResults: AssertExact<
        CheckOnlyProps['validationResults'],
        ModelValidationResult[] | undefined
      > = true;
      assert.strictEqual(
        assertCheckOnlyValid && assertCheckOnlyErrors && assertCheckOnlyResults,
        true,
      );

      // t.object without additionalProperties must NOT widen into a 12-member union,
      // and must synthesize required (-?) nested setters for dynamic fields.
      const CardDef = defineComponent({
        name: 'Card',
        parameters: [
          t.param(
            'header',
            t.object([
              t.param('title', t.string({dynamic: true}), {required: true}),
              t.param('count', t.integer()),
            ]),
            {required: true},
          ),
          t.param('tags', t.array(t.string())),
          t.param('bound', t.dataBinding()),
          t.param('refLabel', t.ref('DynLabel'), {required: true}),
        ],
      });
      const CardTypes = {
        DynLabel: t.string({dynamic: true}),
      } as const;
      type CardProps = ResolveDefinitionProps<typeof CardDef, typeof CardTypes>;

      const assertHeaderTitle: AssertExact<CardProps['header']['title'], string> = true;
      const assertHeaderCount: AssertExact<CardProps['header']['count'], number | undefined> = true;
      const assertNestedSetter: AssertExact<
        CardProps['header']['setTitle'],
        (value: string) => void
      > = true;
      const assertTags: AssertExact<CardProps['tags'], string[] | undefined> = true;
      const assertRefSetter: AssertExact<CardProps['setRefLabel'], (value: string) => void> = true;
      const assertBoundSetter: AssertExact<CardProps['setBound'], (value: unknown) => void> = true;
      assert.strictEqual(
        assertHeaderTitle &&
          assertHeaderCount &&
          assertNestedSetter &&
          assertTags &&
          assertRefSetter &&
          assertBoundSetter,
        true,
      );

      // @ts-expect-error header is an object, not a string (proves no TypeDefinition widening)
      const _badHeader: CardProps['header'] = 'not-an-object';
      void _badHeader;

      // ResolveFunctionDefinitionArgs without additionalParameters must not widen.
      const AddFn = defineFunction({
        name: 'add',
        returnType: 'number',
        parameters: [t.param('a', t.number(), {required: true}), t.param('b', t.number())],
      });
      type AddArgs = ResolveFunctionDefinitionArgs<typeof AddFn>;
      const assertAddA: AssertExact<AddArgs['a'], number> = true;
      const assertAddB: AssertExact<AddArgs['b'], number | undefined> = true;
      assert.strictEqual(assertAddA && assertAddB, true);
      assert.strictEqual(Divider.name, 'Divider');
      assert.strictEqual(CheckOnly.checkable, true);
      assert.strictEqual(CardDef.name, 'Card');
      assert.strictEqual(CardTypes.DynLabel.type, 'string');
      assert.strictEqual(AddFn.name, 'add');
    });

    it('round-trips multi-group atLeastOneOf through JSON Schema as allOf of anyOf groups', () => {
      const model = defineCatalog({
        catalogId: 'https://example.com/multi-group',
        protocolVersion: '1.0',
        components: [
          defineComponent({
            name: 'RangeBox',
            parameters: [
              t.param('minX', t.number()),
              t.param('maxX', t.number()),
              t.param('minY', t.number()),
              t.param('maxY', t.number()),
              t.param(
                'bounds',
                t.object(
                  [
                    t.param('left', t.number()),
                    t.param('right', t.number()),
                    t.param('top', t.number()),
                    t.param('bottom', t.number()),
                  ],
                  {
                    atLeastOneOf: [
                      ['left', 'right'],
                      ['top', 'bottom'],
                    ],
                  },
                ),
              ),
            ],
            atLeastOneOf: [
              ['minX', 'maxX'],
              ['minY', 'maxY'],
            ],
          }),
        ],
        functions: [
          defineFunction({
            name: 'clamp2d',
            returnType: 'boolean',
            parameters: [
              t.param('minX', t.number()),
              t.param('maxX', t.number()),
              t.param('minY', t.number()),
              t.param('maxY', t.number()),
            ],
            atLeastOneOf: [
              ['minX', 'maxX'],
              ['minY', 'maxY'],
            ],
          }),
        ],
      });

      const jsonSchema = modelToJsonSchema(model);
      const compSchema = (jsonSchema['components'] as Record<string, Record<string, unknown>>)[
        'RangeBox'
      ];
      const innerAllOf = compSchema['allOf'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(innerAllOf) && innerAllOf.length === 2);
      assert.strictEqual(compSchema['anyOf'], undefined);

      const roundTripped = jsonSchemaToModel(jsonSchema);
      const rtComp = roundTripped.components?.find(c => c.name === 'RangeBox');
      assert.deepStrictEqual(rtComp?.atLeastOneOf, [
        ['minX', 'maxX'],
        ['minY', 'maxY'],
      ]);
      const boundsParam = rtComp?.parameters?.find(p => p.name === 'bounds');
      assert.ok(boundsParam && boundsParam.type === 'object');
      assert.deepStrictEqual(boundsParam.atLeastOneOf, [
        ['left', 'right'],
        ['top', 'bottom'],
      ]);
      const rtFn = roundTripped.functions?.find(f => f.name === 'clamp2d');
      assert.deepStrictEqual(rtFn?.atLeastOneOf, [
        ['minX', 'maxX'],
        ['minY', 'maxY'],
      ]);
    });

    it('strictly validates RFC 3339 date/time/date-time, URI schemes, and Unicode code-point lengths', () => {
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'date'}), '2024-02-29').success,
        true,
      );
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'date'}), '2024-02-31').success,
        false,
      );
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'date'}), '2023-02-29').success,
        false,
      );
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'date'}), '2024-13-01').success,
        false,
      );

      assert.strictEqual(
        validateCatalogValue(t.string({format: 'time'}), '12:30:45Z').success,
        true,
      );
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'time'}), '23:59:59.123+05:30').success,
        true,
      );
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'time'}), '99:99:99Z').success,
        false,
      );
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'time'}), '12:00:00').success,
        false,
      );

      assert.strictEqual(
        validateCatalogValue(t.string({format: 'date-time'}), '2024-02-29t12:00:00z').success,
        true,
      );
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'date-time'}), '2024-02-31T12:00:00Z').success,
        false,
      );
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'date-time'}), '2024-02-29T12:00:00').success,
        false,
      );

      assert.strictEqual(
        validateCatalogValue(t.string({format: 'uri'}), 'https://example.com/a?b=1').success,
        true,
      );
      assert.strictEqual(validateCatalogValue(t.string({format: 'uri'}), 'hello').success, false);
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'uri'}), '  https://example.com  ').success,
        false,
      );
      assert.strictEqual(
        validateCatalogValue(t.string({format: 'uri'}), '123://invalid-scheme').success,
        false,
      );

      // Unicode code points (emoji is 1 code point, 2 UTF-16 code units).
      assert.strictEqual(validateCatalogValue(t.string({maxLength: 1}), '😀').success, true);
      assert.strictEqual(validateCatalogValue(t.string({minLength: 2}), '😀').success, false);
      assert.strictEqual(
        validateCatalogValue(t.string({minLength: 2, maxLength: 2}), '😀🎉').success,
        true,
      );

      // Invalid regex pattern constructed programmatically fails validation cleanly.
      const invalidPatternRes = validateCatalogValue(t.string({pattern: '[unclosed'}), 'abc');
      assert.strictEqual(invalidPatternRes.success, false);
    });

    it('rejects unknown keys, inverted bounds, bad enums, bad regex, bad SemVer, and unguarded ref cycles in parseCatalogDocument', () => {
      const base = {
        formatVersion: '1.0',
        catalogId: 'https://example.com/strict',
        protocolVersion: '1.0',
      };

      assert.throws(() => parseCatalogDocument({...base, bogusRoot: true}), A2uiCatalogError);
      assert.throws(
        () => parseCatalogDocument({...base, protocolVersion: 'not-a-semver'}),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            components: [{name: 'Card', checkabel: true}],
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            components: [
              {
                name: 'Card',
                parameters: [{name: 'title', type: 'string', requried: true}],
              },
            ],
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            components: [
              {
                name: 'Card',
                parameters: [{name: 'slot', type: 'child', dynamic: true}],
              },
            ],
          }),
        A2uiCatalogError,
      );
      // Inverted bounds
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {BadStr: {type: 'string', minLength: 5, maxLength: 2}},
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {BadNum: {type: 'number', min: 10, max: 5}},
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {BadArr: {type: 'array', minItems: 3, maxItems: 1}},
          }),
        A2uiCatalogError,
      );
      // Invalid regex pattern
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {BadRe: {type: 'string', pattern: '[unclosed'}},
          }),
        A2uiCatalogError,
      );
      // Enum invariants
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {Mixed: {type: 'enum', values: ['a', 1]}},
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {WrongDefaultType: {type: 'enum', values: [1, 2]}},
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {Dup: {type: 'enum', values: ['a', 'a']}},
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {BadDef: {type: 'enum', values: ['a', 'b'], default: 'c'}},
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {NonFinite: {type: 'enum', valueType: 'number', values: [1, Number.NaN]}},
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {BadConst: {type: 'const', value: Number.POSITIVE_INFINITY}},
          }),
        A2uiCatalogError,
      );
      // any(nullable: false, default: null)
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {BadAny: {type: 'any', nullable: false, default: null}},
          }),
        A2uiCatalogError,
      );
      // Unguarded alias and union ref cycles rejected, structural recursion accepted
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {A: {type: 'ref', ref: 'A'}},
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {
              A: {type: 'ref', ref: 'B'},
              B: {type: 'ref', ref: 'A'},
            },
          }),
        A2uiCatalogError,
      );
      assert.throws(
        () =>
          parseCatalogDocument({
            ...base,
            types: {
              A: {type: 'union', variants: [{type: 'ref', ref: 'A'}, {type: 'string'}]},
            },
          }),
        A2uiCatalogError,
      );
      const recursiveDoc = parseCatalogDocument({
        ...base,
        types: {
          Node: {
            type: 'object',
            properties: [
              {name: 'label', type: 'string', required: true},
              {name: 'next', type: 'ref', ref: 'Node'},
            ],
          },
        },
      });
      assert.ok(recursiveDoc.types?.['Node']);
    });

    it('round-trips cyclic $defs, non-dynamic multi-format strings, reversed allOf, v0.9 FunctionCall, and constrained DynamicStringList in jsonSchemaToModel', () => {
      // 1. Cyclic local $defs -> {type: 'ref', ref: 'Node'}
      const cyclicSchema = {
        catalogId: 'https://example.com/cyclic-json-schema',
        protocolVersion: '1.0',
        $defs: {
          Node: {
            type: 'object',
            properties: {
              label: {type: 'string'},
              next: {$ref: '#/$defs/Node'},
            },
            required: ['label'],
            additionalProperties: false,
          },
        },
        components: {
          Tree: {
            type: 'object',
            allOf: [
              {$ref: 'common_types.json#/$defs/ComponentCommon'},
              {
                type: 'object',
                properties: {
                  component: {const: 'Tree'},
                  root: {$ref: '#/$defs/Node'},
                },
                required: ['component', 'root'],
              },
            ],
          },
        },
      };
      const cyclicModel = jsonSchemaToModel(cyclicSchema);
      const nodeType = cyclicModel.types?.['Node'];
      assert.ok(nodeType && nodeType.type === 'object');
      const nextProp = nodeType.properties?.find(p => p.name === 'next');
      assert.deepStrictEqual(nextProp, {name: 'next', type: 'ref', ref: 'Node'});

      // 2. Non-dynamic multi-format StringType round-trip
      const multiFmtModel = defineCatalog({
        catalogId: 'https://example.com/multi-fmt',
        protocolVersion: '1.0',
        components: [
          defineComponent({
            name: 'Picker',
            parameters: [
              t.param('when', t.string({format: ['date', 'time']})),
              t.param('tags', t.array(t.string({minLength: 3}), {dynamic: true})),
            ],
          }),
        ],
      });
      const emitted = modelToJsonSchema(multiFmtModel);
      const reparsed = jsonSchemaToModel(emitted);
      const picker = reparsed.components?.find(c => c.name === 'Picker');
      const whenParam = picker?.parameters?.find(p => p.name === 'when');
      assert.ok(whenParam && whenParam.type === 'string');
      assert.deepStrictEqual(whenParam.format, ['date', 'time']);
      assert.strictEqual(whenParam.dynamic, undefined);

      // Dynamic array of constrained strings must NOT collapse to DynamicStringList
      const tagsParam = picker?.parameters?.find(p => p.name === 'tags');
      assert.ok(tagsParam && tagsParam.type === 'array' && tagsParam.dynamic === true);
      assert.ok(tagsParam.items && tagsParam.items.type === 'string');
      assert.strictEqual(tagsParam.items.minLength, 3);

      // 3. Reversed allOf ([if/then, DynamicString]) and v0.9 FunctionCall allOf
      const reversedAllOfModel = jsonSchemaToModel({
        catalogId: 'https://example.com/reversed-allof',
        protocolVersion: '0.9',
        components: {
          Input: {
            type: 'object',
            allOf: [
              {$ref: 'common_types.json#/$defs/ComponentCommon'},
              {
                type: 'object',
                properties: {
                  component: {const: 'Input'},
                  dateVal: {
                    allOf: [
                      {if: {type: 'string'}, then: {format: 'date'}},
                      {$ref: 'common_types.json#/$defs/DynamicString'},
                    ],
                  },
                  v09DynStr: {
                    oneOf: [
                      {type: 'string'},
                      {$ref: 'common_types.json#/$defs/DataBinding'},
                      {
                        allOf: [
                          {$ref: 'common_types.json#/$defs/FunctionCall'},
                          {properties: {returnType: {const: 'string'}}},
                        ],
                      },
                    ],
                  },
                },
                required: ['component'],
              },
            ],
          },
        },
      });
      const inputComp = reversedAllOfModel.components?.find(c => c.name === 'Input');
      const dateVal = inputComp?.parameters?.find(p => p.name === 'dateVal');
      assert.ok(dateVal && dateVal.type === 'string' && dateVal.dynamic === true);
      assert.strictEqual(dateVal.format, 'date');
      const v09DynStr = inputComp?.parameters?.find(p => p.name === 'v09DynStr');
      assert.ok(v09DynStr && v09DynStr.type === 'string' && v09DynStr.dynamic === true);

      // 4. v0.9 component and map-layout function schema alignment
      const v09CompSchema = componentDefinitionToJsonSchema(
        defineComponent({name: 'Pill', parameters: [t.param('label', t.string())]}),
        {protocolVersion: '0.9'},
      );
      assert.strictEqual(v09CompSchema['unevaluatedProperties'], false);
      const v09FnSchema = functionDefinitionToJsonSchema(
        defineFunction({name: 'fmt', returnType: 'string', parameters: [t.param('v', t.string())]}),
        {protocolVersion: '0.9', functionsLayout: 'map'},
      );
      assert.strictEqual(v09FnSchema['unevaluatedProperties'], false);
      const fnProps = v09FnSchema['properties'] as Record<string, unknown>;
      assert.deepStrictEqual(fnProps['returnType'], {const: 'string'});
    });

    it('enforces v0.9 vs v1.0 CheckRule/Action rules, tightened binding/call guards, and catalog_model helpers', () => {
      // v0.9 CheckRule allows literal boolean condition and requires message.
      assert.strictEqual(
        validateCatalogValue(
          t.checkRule(),
          {condition: true, message: 'ok'},
          {protocolVersion: '0.9'},
        ).success,
        true,
      );
      assert.strictEqual(
        validateCatalogValue(t.checkRule(), {condition: {path: '/ok'}}, {protocolVersion: '0.9'})
          .success,
        false,
      );
      // v1.0 CheckRule rejects literal boolean condition and allows omitted message.
      assert.strictEqual(
        validateCatalogValue(t.checkRule(), {condition: true}, {protocolVersion: '1.0'}).success,
        false,
      );
      assert.strictEqual(
        validateCatalogValue(t.checkRule(), {condition: {'@path': '/ok'}}, {protocolVersion: '1.0'})
          .success,
        true,
      );

      // v0.9 Action.event rejects userMessage; v1.0 allows it.
      assert.strictEqual(
        validateCatalogValue(
          t.action(),
          {event: {name: 'go', userMessage: 'Going'}},
          {protocolVersion: '0.9'},
        ).success,
        false,
      );
      assert.strictEqual(
        validateCatalogValue(
          t.action(),
          {event: {name: 'go', userMessage: 'Going'}},
          {protocolVersion: '1.0'},
        ).success,
        true,
      );

      // Tightened dataBinding / functionCall guards and non-dynamic any.
      assert.strictEqual(isDataBindingValue({'@path': '/a', path: '/b'}), false);
      assert.strictEqual(isFunctionCallValue({'@call': ''}), false);
      assert.strictEqual(isFunctionCallValue({'@call': 'f', call: 'f'}), false);
      assert.strictEqual(isFunctionCallValue({'@call': 'f', bogus: 1}), false);
      assert.strictEqual(
        validateCatalogValue(t.any({dynamic: false, nullable: false}), {path: 42}).success,
        true,
      );

      // catalog_model helper consistency
      assert.strictEqual(functionReturnTypeName('integer'), 'number');
      assert.strictEqual(functionReturnTypeName(t.integer()), 'number');
      assert.strictEqual(functionReturnTypeName(t.enum([1, 2], {valueType: 'number'})), 'number');
      assert.strictEqual(
        isComponentDefinition({name: 'Foo', parameters: 'garbage', checkable: true}),
        false,
      );
    });
  });
});
