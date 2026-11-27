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
  defineCatalog,
  defineComponent,
  defineFunction,
  defineSurfaceProperties,
  definitionEnvelopeLayout,
  definitionToBehavior,
  extractDefinitionRefFields,
  findDynamicBooleanParamNames,
  getFunctionDefinitionParameterNames,
  isCatalogDocument,
  parseCatalogDocument,
  serializeCatalogDocument,
  t,
  validateCatalogValue,
  validateComponentProperties,
  validateFunctionArguments,
  validateSurfaceProperties,
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
});
