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

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {createAjvValidator} from '@a2ui/validator-ajv';
import {
  Catalog,
  type ComponentApi,
  type InferredComponentApiSchemaType,
} from '@a2ui/web_core/catalog';
import {MessageProcessor} from '@a2ui/web_core/processing';
import {
  NodeResolver,
  ResolvedBinding,
  type ComponentNode,
  type ResolveA2uiProps,
} from '@a2ui/web_core/resolution';
import {A2uiValidationError} from '@a2ui/web_core/errors';
import {peekValue} from '@a2ui/web_core/reactivity';
import {z} from 'zod';

import * as root from './index.js';
import * as v0_9 from './v0_9.js';
import * as v1_0 from './v1_0.js';

/** Compile-time check that `A` and `B` are the same type. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** Compile-time check that `A` and `B` are assignable to each other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const expectType = <T extends true>(_: T) => {};

const ref = (name: string) => ({$ref: `common_types.json#/$defs/${name}`});

/**
 * A version's helpers. Both versions export the same names; tests that run
 * for each version see them as v1.0's.
 */
type Helpers = typeof v1_0;

/** A component built with a version's helpers. */
function cardOf(h: Helpers) {
  return h.component({
    title: h.DynamicString,
    subtitle: h.DynamicString.describe('Shown under the title').optional(),
    count: h.DynamicNumber.optional(),
    open: h.DynamicBoolean.default(false),
    tags: h.DynamicStringList.optional(),
    extra: h.DynamicValue.optional(),
    child: h.Child.optional(),
    children: h.ChildList.optional(),
    onOpen: h.Action.optional(),
    a11y: h.AccessibilityAttributes.optional(),
    size: z.enum(['s', 'l']).optional(),
  });
}

const cases = [
  {
    version: '1.0',
    h: v1_0 as Helpers,
    childRef: 'Child',
    path: (p: string) => ({'@path': p}),
    otherPath: (p: string) => ({path: p}),
    call: (name: string) => ({'@call': name}),
    otherCall: (name: string) => ({call: name}),
    envelope: {version: '1.0'},
  },
  {
    version: '0.9',
    h: v0_9 as unknown as Helpers,
    childRef: 'ComponentId',
    path: (p: string) => ({path: p}),
    otherPath: (p: string) => ({'@path': p}),
    call: (name: string) => ({call: name}),
    otherCall: (name: string) => ({'@call': name}),
    envelope: {version: 'v0.9'},
  },
] as const;

for (const c of cases) {
  describe(`v${c.version} helpers`, () => {
    it('emits $refs to the common types', () => {
      const json = cardOf(c.h)['~standard'].jsonSchema.input({target: 'draft-2020-12'});
      const props = json.properties as Record<string, unknown>;
      assert.deepEqual(props.title, ref('DynamicString'));
      assert.deepEqual(props.subtitle, {
        ...ref('DynamicString'),
        description: 'Shown under the title',
      });
      assert.deepEqual(props.count, ref('DynamicNumber'));
      assert.deepEqual(props.open, {...ref('DynamicBoolean'), default: false});
      assert.deepEqual(props.tags, ref('DynamicStringList'));
      assert.deepEqual(props.extra, ref('DynamicValue'));
      assert.deepEqual(props.child, ref(c.childRef));
      assert.deepEqual(props.children, ref('ChildList'));
      assert.deepEqual(props.onOpen, ref('Action'));
      assert.deepEqual(props.a11y, ref('AccessibilityAttributes'));
      assert.deepEqual(props.size, {type: 'string', enum: ['s', 'l']});
      assert.equal(json.$schema, 'https://json-schema.org/draft/2020-12/schema');
      assert.deepEqual(json.required, ['title']);
      assert.equal(JSON.stringify(json).includes('$defs"'), false, 'nothing is inlined into $defs');
      assert.equal(JSON.stringify(json).includes('"#/'), false, 'no reference to the root');
    });

    it('emits each common type as a bare $ref', () => {
      for (const name of [
        'DataBinding',
        'FunctionCall',
        'DynamicString',
        'DynamicNumber',
        'DynamicBoolean',
        'DynamicStringList',
        'DynamicValue',
        'ChildList',
        'Action',
        'CheckRule',
        'Checkable',
        'AccessibilityAttributes',
        'ComponentId',
      ] as const) {
        const json = c.h.a2uiJsonSchema((c.h as Record<string, unknown>)[name] as z.ZodTypeAny);
        const {$schema: _, ...rest} = json;
        assert.deepEqual(rest, ref(name), name);
      }
    });

    it('validates the spec spelling of bindings and calls, and rejects the other', () => {
      const validate = (v: unknown) => cardOf(c.h)['~standard'].validate(v);
      const ok = (v: unknown) => {
        const r = validate(v);
        assert.ok(!(r instanceof Promise));
        assert.equal(r.issues, undefined, JSON.stringify(v));
        return r;
      };
      const bad = (v: unknown) => {
        const r = validate(v);
        assert.ok(!(r instanceof Promise));
        assert.ok(r.issues && r.issues.length > 0, JSON.stringify(v));
      };
      ok({title: 'Hi'});
      ok({title: c.path('/a')});
      ok({title: c.call('upper')});
      ok({title: 'x', count: c.path('/n'), open: c.call('isOpen'), children: ['a', 'b']});
      ok({title: 'x', children: {componentId: 'row', path: '/items'}});
      ok({title: 'x', onOpen: {event: {name: 'open', context: {id: c.path('/id')}}}});
      ok({title: 'x', onOpen: {functionCall: c.call('openUrl')}});
      bad({title: c.otherPath('/a')});
      bad({title: c.otherCall('upper')});
      bad({title: 'x', count: c.otherPath('/n')});
      bad({title: 'x', onOpen: {functionCall: c.otherCall('openUrl')}});
      bad({title: 1});
      bad({});
    });

    it('fills defaults on the value it validates', () => {
      const r = cardOf(c.h)['~standard'].validate({title: 'Hi'});
      assert.ok(!(r instanceof Promise) && !r.issues);
      assert.deepEqual(r.value, {title: 'Hi', open: false});
    });

    it('gives a component in a catalog its resolved props', () => {
      const Card = {name: 'Card', schema: cardOf(c.h)};
      const Label = {name: 'Label', schema: c.h.component({text: c.h.DynamicString})};
      const catalog = new Catalog<ComponentApi>(
        `https://example.com/zod3-${c.version}.json`,
        c.version,
        [Card, Label],
      );
      const proc = new MessageProcessor([catalog], undefined, {validator: createAjvValidator()});
      const send = (message: Record<string, unknown>) =>
        proc.processMessages([{...c.envelope, ...message} as never]);
      send({createSurface: {surfaceId: 's', catalogId: catalog.id}});
      const surface = proc.model.getSurface('s')!;
      surface.dataModel.set('/title', 'From the model');
      send({
        updateComponents: {
          surfaceId: 's',
          components: [
            {id: 'root', component: 'Card', title: c.path('/title'), children: ['l1'], count: 3},
            {id: 'l1', component: 'Label', text: 'Hello'},
          ],
        },
      });
      const resolver = new NodeResolver(surface, catalog);
      const node = peekValue(resolver.rootNode)!;
      assert.equal(node.type, 'Card');
      const props = peekValue(node.props) as Record<string, unknown>;
      assert.ok(props.title instanceof ResolvedBinding);
      assert.equal(props.title.value, 'From the model');
      assert.ok(props.count instanceof ResolvedBinding);
      assert.equal(props.count.value, 3);
      const [label] = props.children as ComponentNode[];
      assert.equal(label.type, 'Label');
      assert.equal((peekValue(label.props).text as ResolvedBinding<string>).value, 'Hello');

      assert.throws(
        () =>
          send({
            updateComponents: {
              surfaceId: 's',
              components: [{id: 'l2', component: 'Label', text: c.otherPath('/title')}],
            },
          }),
        A2uiValidationError,
      );
      resolver.dispose();
      proc.dispose();
    });
  });
}

describe('types', () => {
  it('infers the props a component validates and resolves', () => {
    const Card = {name: 'Card', schema: cardOf(v1_0)};
    type Props = InferredComponentApiSchemaType<typeof Card>;
    expectType<
      Same<
        Props['title'],
        | string
        | {'@path': string}
        | {'@call': string; catalogId?: string; args?: Record<string, unknown>}
      >
    >(true);
    type Resolved = ResolveA2uiProps<Props>;
    expectType<Equal<Resolved['title'], string>>(true);
    expectType<Equal<Resolved['count'], number | undefined>>(true);
    expectType<Equal<Resolved['open'], boolean>>(true);
    const V09Card = {name: 'Card', schema: v0_9.component({title: v0_9.DynamicString})};
    type V09Resolved = ResolveA2uiProps<InferredComponentApiSchemaType<typeof V09Card>>;
    expectType<Equal<V09Resolved['title'], string>>(true);
    assert.equal(Card.name, V09Card.name);
  });
});

describe('fromZod3', () => {
  it('is what web_core asks a raw zod 3 schema to be wrapped with', () => {
    const shape = {text: root.DynamicString};
    assert.throws(
      () =>
        new Catalog('https://example.com/raw.json', '1.0', [
          {name: 'Raw', schema: z.object(shape) as never},
        ]),
      /fromZod3\(\) from @a2ui\/schema-zod3/,
    );
    const catalog = new Catalog('https://example.com/wrapped.json', '1.0', [
      {name: 'Wrapped', schema: root.fromZod3(z.object(shape))},
    ]);
    assert.ok(catalog.components.has('Wrapped'));
  });

  it('converts to the targets zod-to-json-schema has', () => {
    const schema = root.component({text: root.DynamicString});
    const draft7 = schema['~standard'].jsonSchema.input({target: 'draft-07'});
    assert.equal(draft7.$schema, 'http://json-schema.org/draft-07/schema#');
    assert.deepEqual((draft7.properties as Record<string, unknown>).text, ref('DynamicString'));
    const openapi = schema['~standard'].jsonSchema.input({target: 'openapi-3.0'});
    assert.equal(openapi.$schema, undefined);
    assert.throws(() => schema['~standard'].jsonSchema.input({target: 'draft-04'}), /draft-04/);
  });

  it('leaves other uses of a common type unchanged', () => {
    const json = root
      .component({
        a: root.DynamicString,
        b: root.DynamicString.describe('B'),
        c: z.string(),
      })
      ['~standard'].jsonSchema.input({target: 'draft-2020-12'});
    const props = json.properties as Record<string, unknown>;
    assert.deepEqual(props.a, ref('DynamicString'));
    assert.deepEqual(props.b, {...ref('DynamicString'), description: 'B'});
    assert.deepEqual(props.c, {type: 'string'});
  });
});

describe('the package root', () => {
  it('exports the v1.0 helpers', () => {
    for (const [name, value] of Object.entries(v1_0)) {
      assert.equal((root as Record<string, unknown>)[name], value, name);
    }
    assert.deepEqual(Object.keys(v0_9).sort(), Object.keys(v1_0).sort());
    assert.equal(root.component, v1_0.component);
    assert.equal(root.v0_9.DataBinding, v0_9.DataBinding);
    assert.equal(root.v1_0.DataBinding, v1_0.DataBinding);
  });

  it('wraps any zod 3 schema with fromZod3', () => {
    const schema = root.fromZod3(
      z.object({value: root.DynamicString}).extend(root.Checkable.shape),
    );
    const json = schema['~standard'].jsonSchema.input({target: 'draft-2020-12'});
    const props = json.properties as Record<string, unknown>;
    assert.deepEqual(props.value, ref('DynamicString'));
    assert.deepEqual(props['@checks'], {type: 'array', items: ref('CheckRule')});
  });
});
