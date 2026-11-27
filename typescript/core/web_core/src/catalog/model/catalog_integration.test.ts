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
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, it} from 'node:test';
import {z} from 'zod';

import {
  Catalog,
  createFunctionImplementation,
  defineComponent,
  defineComponentApi,
  defineFunction,
  defineFunctionApi,
  defineSurfaceProperties,
  isCatalogDocument,
  t,
  type ComponentDefinition,
  type DataTypeDefinition,
  type FunctionDefinition,
  type TypeDefinition,
} from '../index.js';
import {MessageProcessor} from '../../processing/message-processor.js';
import {
  ComponentContext,
  GenericBinder,
  isComponentNode,
  isWritable,
  NodeResolver,
  ResolvedBinding,
} from '../../resolution/index.js';
import {getValue} from '../../reactivity/signals.js';
import {PayloadValidator} from '../../validation/payload-validator.js';
import {STRICT_VALIDATION} from '../../validation/integrity-checker.js';

function readRepoJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), '../../..', relativePath), 'utf-8'));
}

function collectRawJsonSchemaPaths(
  typeDef: TypeDefinition | DataTypeDefinition,
  path: string,
  out: string[],
): void {
  if (typeDef.type === 'rawJsonSchema') {
    out.push(path);
    return;
  }
  if (typeDef.type === 'array' && typeDef.items) {
    collectRawJsonSchemaPaths(typeDef.items, `${path}[]`, out);
  } else if (typeDef.type === 'object') {
    for (const prop of typeDef.properties ?? []) {
      collectRawJsonSchemaPaths(prop, `${path}.${prop.name}`, out);
    }
    if (typeDef.additionalProperties && typeof typeDef.additionalProperties === 'object') {
      collectRawJsonSchemaPaths(typeDef.additionalProperties, `${path}.*`, out);
    }
  } else if (typeDef.type === 'union') {
    typeDef.variants.forEach((variant, idx) => {
      collectRawJsonSchemaPaths(variant, `${path}|${idx}`, out);
    });
  }
}

describe('CatalogModel end-to-end integration and lossless round-trips', () => {
  it('runs MessageProcessor, PayloadValidator, IntegrityChecker, NodeResolver, and GenericBinder on a pure model-defined catalog without Zod', async () => {
    const StackDef = defineComponent({
      name: 'Stack',
      allowedChildren: ['Badge', 'ActionButton'],
      parameters: [t.param('items', t.childList(), {required: true})],
    });

    const BadgeDef = defineComponent({
      name: 'Badge',
      checkable: true,
      parameters: [
        t.param('label', t.string({dynamic: true}), {required: true}),
        t.param('metadata', t.string({dynamic: true})), // custom bare property alongside @metadata
      ],
    });

    const ActionButtonDef = defineComponent({
      name: 'ActionButton',
      parameters: [
        t.param('caption', t.child(), {required: true}),
        t.param('onClick', t.action(), {required: true}),
      ],
    });

    const UpperFnDef = defineFunction({
      name: 'upper',
      returnType: 'string',
      parameters: [
        t.param('text', t.string({dynamic: true}), {required: true}),
        t.param('prefix', t.string({default: ''})),
      ],
    });

    const NonEmptyFnDef = defineFunction({
      name: 'nonEmpty',
      returnType: 'validationResult',
      parameters: [t.param('value', t.string({dynamic: true}), {required: true})],
    });

    const SurfaceThemeDef = defineSurfaceProperties({
      properties: [t.param('accentColor', t.string({pattern: '^#[0-9a-fA-F]{6}$'}))],
    });

    const StackApi = defineComponentApi(StackDef);
    const BadgeApi = defineComponentApi(BadgeDef);
    const ActionButtonApi = defineComponentApi(ActionButtonDef);

    // Zero Zod schemas on any entry
    assert.strictEqual(StackApi.schema, undefined);
    assert.strictEqual(BadgeApi.schema, undefined);
    assert.strictEqual(ActionButtonApi.schema, undefined);

    const upperImpl = createFunctionImplementation(
      defineFunctionApi(UpperFnDef),
      args => `${args.prefix ?? ''}${args.text.toUpperCase()}`,
    );
    const nonEmptyImpl = createFunctionImplementation(NonEmptyFnDef, args => ({
      valid: args.value.trim().length > 0,
      message: 'Must not be empty',
      severity: 'error' as const,
    }));

    const catalog = new Catalog(
      'https://example.com/pure-model-cat',
      '1.0',
      [StackApi, BadgeApi, ActionButtonApi],
      [upperImpl, nonEmptyImpl],
      {surfaceProperties: SurfaceThemeDef},
    );

    const dispatchedActions: unknown[] = [];
    const processor = new MessageProcessor(
      [catalog],
      action => {
        dispatchedActions.push(action);
      },
      {validationConfig: STRICT_VALIDATION},
    );

    processor.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'https://example.com/pure-model-cat',
        },
      },
      {
        version: '1.0',
        updateDataModel: {
          surfaceId: 's1',
          path: '/',
          value: {title: 'hello', note: 'custom-meta'},
        },
      },
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {id: 'root', component: 'Stack', items: ['btn1', 'badge1']},
            {
              id: 'btn1',
              component: 'ActionButton',
              caption: 'badge1',
              onClick: {event: {name: 'pressed', context: {label: {'@path': '/title'}}}},
            },
            {
              id: 'badge1',
              component: 'Badge',
              '@metadata': {extensions: {source: 'model-test'}},
              '@accessibility': {label: {'@path': '/title'}},
              '@checks': [
                {
                  condition: {'@call': 'nonEmpty', 'args': {'value': {'@path': '/title'}}},
                  message: 'Required',
                },
              ],
              label: {'@call': 'upper', 'args': {'text': {'@path': '/title'}, 'prefix': '>'}},
              metadata: {'@path': '/note'},
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s1')!;
    assert.ok(surface);

    // 1. NodeResolver resolves child/childList slots, reactive props, checks, and actions.
    const resolver = new NodeResolver(surface);
    const rootNode = getValue(resolver.rootNode)!;
    assert.ok(rootNode);
    const rootProps = getValue(rootNode.props);
    const items = rootProps['items'] as unknown[];
    assert.strictEqual(items.length, 2);
    assert.ok(isComponentNode(items[0]));
    assert.ok(isComponentNode(items[1]));

    const badgeNode = items[1];
    const badgeProps = getValue(badgeNode.props);
    assert.ok(badgeProps['label'] instanceof ResolvedBinding);
    assert.strictEqual(badgeProps['label'].value, '>HELLO');
    assert.ok(badgeProps['metadata'] instanceof ResolvedBinding);
    assert.strictEqual(badgeProps['metadata'].value, 'custom-meta');
    assert.strictEqual(
      badgeNode.context?.componentModel.metadata?.extensions?.['source'],
      'model-test',
    );
    assert.strictEqual(badgeProps['isValid'], true);

    // Two-way write via writable binding updates reactive label and check state!
    assert.ok(isWritable(badgeProps['metadata']));
    badgeProps['metadata'].set('updated-meta');
    assert.strictEqual(surface.dataModel.get('/note'), 'updated-meta');

    surface.dataModel.set('/title', '   ');
    assert.strictEqual(getValue(badgeNode.props)['isValid'], false);
    assert.deepStrictEqual(getValue(badgeNode.props)['validationErrors'], ['Required']);

    // Action dispatch
    const btnNode = items[0];
    const onClick = getValue(btnNode.props)['onClick'] as () => Promise<void>;
    await onClick();
    assert.strictEqual(dispatchedActions.length, 1);

    // 2. GenericBinder works directly with a canonical ComponentDefinition.
    const badgeCtx = new ComponentContext(surface, 'badge1', '/');
    const binder = new GenericBinder<{label: string; metadata?: string; isValid?: boolean}>(
      badgeCtx,
      BadgeDef,
    );
    const sub = binder.subscribe(() => {});
    surface.dataModel.set('/title', 'world');
    assert.strictEqual(binder.snapshot.label, '>WORLD');
    assert.strictEqual(binder.snapshot.metadata, 'updated-meta');
    assert.strictEqual(binder.snapshot.isValid, true);
    sub.unsubscribe();
    binder.dispose();

    // 3. IntegrityChecker enforces allowedChildren and dangling refs from buildModelReferenceMap.
    assert.throws(
      () =>
        processor.processMessages([
          {
            version: '1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [{id: 'root', component: 'Stack', items: ['missing-id']}],
            },
          },
        ]),
      /Dangling reference/,
    );

    // 4. PayloadValidator rejects invalid theme against surfaceProperties.
    const validator = new PayloadValidator(catalog);
    assert.throws(() => validator.validateTheme({accentColor: 'not-a-hex'}));
    assert.deepStrictEqual(validator.validateTheme({accentColor: '#abcdef'}), {
      accentColor: '#abcdef',
    });

    resolver.dispose();
  });

  it('loads a Catalog Document via both Catalog.fromDocument and Catalog.fromJson auto-detection', () => {
    const doc = {
      formatVersion: '1.0',
      catalogId: 'https://example.com/doc-catalog',
      protocolVersion: '1.0',
      title: 'Doc Catalog',
      types: {
        LabelText: {type: 'string', dynamic: true, minLength: 1},
      },
      components: [
        {
          name: 'Notice',
          checkable: true,
          parameters: [
            {name: 'text', type: 'ref', ref: 'LabelText', required: true},
            {name: 'severity', type: 'enum', values: ['info', 'warn']},
          ],
        },
      ],
      functions: [
        {
          name: 'echo',
          returnType: 'string',
          parameters: [{name: 'value', type: 'string', required: true}],
        },
      ],
    };

    assert.strictEqual(isCatalogDocument(doc), true);

    const fromDoc = Catalog.fromDocument(doc);
    assert.strictEqual(fromDoc.id, 'https://example.com/doc-catalog');
    assert.strictEqual(fromDoc.components.get('Notice')?.schema, undefined);
    assert.ok(fromDoc.components.get('Notice')?.definition);
    assert.deepStrictEqual(fromDoc.toDocument(), doc);

    // Catalog.fromJson auto-detects Catalog Documents and validates identically.
    const fromJson = Catalog.fromJson(doc);
    assert.strictEqual(fromJson.id, 'https://example.com/doc-catalog');
    assert.ok(fromJson.components.get('Notice')?.definition);
    assert.deepStrictEqual(fromJson.toDocument(), doc);

    const validator = new PayloadValidator(fromDoc);
    assert.doesNotThrow(() =>
      validator.validateComponent({id: 'n1', component: 'Notice', text: 'hi', severity: 'info'}),
    );
    assert.throws(() =>
      validator.validateComponent({id: 'n1', component: 'Notice', text: '', severity: 'info'}),
    );
    assert.throws(() =>
      validator.validateComponent({id: 'n1', component: 'Notice', text: 'hi', severity: 'bad'}),
    );
  });

  for (const catalogPath of [
    'catalogs/basic/v1/catalog.json',
    'catalogs/mcp/v1/catalog.json',
    'catalogs/vegachart/v1/catalog.json',
  ]) {
    it(`round-trips ${catalogPath} through fromJson -> toDocument -> fromDocument -> toJson with zero rawJsonSchema nodes`, () => {
      const raw = readRepoJson(catalogPath);
      const loaded = Catalog.fromJson(raw);
      const model = loaded.toModel();

      // Zero rawJsonSchema fallback nodes in any published v1 catalog!
      const rawNodes: string[] = [];
      for (const comp of model.components ?? []) {
        for (const param of comp.parameters ?? []) {
          collectRawJsonSchemaPaths(param, `components.${comp.name}.${param.name}`, rawNodes);
        }
      }
      for (const fn of model.functions ?? []) {
        for (const param of fn.parameters ?? []) {
          collectRawJsonSchemaPaths(param, `functions.${fn.name}.${param.name}`, rawNodes);
        }
      }
      for (const [typeName, typeDef] of Object.entries(model.types ?? {})) {
        collectRawJsonSchemaPaths(typeDef, `types.${typeName}`, rawNodes);
      }
      assert.deepStrictEqual(rawNodes, [], `Unexpected rawJsonSchema nodes in ${catalogPath}`);

      // Serialize to Catalog Document and reload via Catalog.fromDocument.
      const doc = loaded.toDocument();
      assert.strictEqual(isCatalogDocument(doc), true);
      assert.strictEqual(doc['formatVersion'], '1.0');

      const reloaded = Catalog.fromDocument(doc);
      assert.strictEqual(reloaded.id, loaded.id);
      assert.deepStrictEqual(
        [...reloaded.components.keys()].sort(),
        [...loaded.components.keys()].sort(),
      );
      assert.deepStrictEqual(
        [...reloaded.functions.keys()].sort(),
        [...loaded.functions.keys()].sort(),
      );

      // Verify reloaded model matches original model 1:1.
      assert.deepStrictEqual(reloaded.toModel(), model);

      // Verify re-emitting legacy JSON Schema via reloaded.toJson() produces a valid
      // JSON Schema catalog that Catalog.fromJson can reload with the same entries.
      const reemittedJson = reloaded.toJson();
      const fromReemitted = Catalog.fromJson(reemittedJson);
      assert.deepStrictEqual(
        [...fromReemitted.components.keys()].sort(),
        [...loaded.components.keys()].sort(),
      );
      assert.deepStrictEqual(
        [...fromReemitted.functions.keys()].sort(),
        [...loaded.functions.keys()].sort(),
      );

      // Spot-check key semantic details of basic/v1
      if (catalogPath === 'catalogs/basic/v1/catalog.json') {
        assert.ok(model.types?.['Weight'], 'preserves local Weight type');
        const dateTime = (model.components ?? []).find(
          (c: ComponentDefinition) => c.name === 'DateTimeInput',
        );
        assert.ok(dateTime && dateTime.checkable === true);
        const minParam = dateTime.parameters?.find(p => p.name === 'min');
        assert.ok(minParam && minParam.type === 'string' && Array.isArray(minParam.format));
        const openUrl = (model.functions ?? []).find(
          (f: FunctionDefinition) => f.name === 'openUrl',
        );
        assert.strictEqual(openUrl?.requiresUserActivation, true);
        const lengthFn = (model.functions ?? []).find(
          (f: FunctionDefinition) => f.name === 'length',
        );
        assert.deepStrictEqual(lengthFn?.atLeastOneOf, [['min', 'max']]);
      }
    });
  }

  it('round-trips catalogs/basic/v0_9_1/catalog.json flattening CatalogComponentCommon and preserving theme', () => {
    const raw = readRepoJson('catalogs/basic/v0_9_1/catalog.json');
    const loaded = Catalog.fromJson(raw, '0.9.1');
    const doc = loaded.toDocument();
    const reloaded = Catalog.fromDocument(doc);
    assert.strictEqual(reloaded.components.size, loaded.components.size);
    assert.strictEqual(reloaded.functions.size, loaded.functions.size);
    assert.ok(reloaded.surfaceProperties, 'theme converted to surfaceProperties');
    const textDef = reloaded.components.get('Text')?.definition;
    assert.ok(textDef?.parameters?.some(p => p.name === 'weight'));
  });

  it('maintains full backward compatibility for legacy Zod ComponentApi and FunctionApi and round-trips to Catalog Document', () => {
    const legacyComp = {
      name: 'LegacyPill',
      schema: z
        .object({
          text: z.string(),
          count: z.number().int().min(0).optional(),
        })
        .strict(),
    };
    const legacyFn = createFunctionImplementation(
      {
        name: 'doubleIt',
        returnType: 'number',
        schema: z.object({n: z.number()}).strict(),
      },
      args => args.n * 2,
    );

    const catalog = new Catalog('https://example.com/legacy', '1.0', [legacyComp], [legacyFn]);
    const doc = catalog.toDocument();
    assert.strictEqual(isCatalogDocument(doc), true);

    const reloaded = Catalog.fromDocument(doc);
    const validator = new PayloadValidator(reloaded);
    assert.doesNotThrow(() =>
      validator.validateComponent({id: 'p1', component: 'LegacyPill', text: 'ok', count: 2}),
    );
    assert.throws(() =>
      validator.validateComponent({id: 'p1', component: 'LegacyPill', text: 'ok', count: -1}),
    );
    assert.throws(() => validator.validateComponent({id: 'p1', component: 'LegacyPill'}));
  });
});
