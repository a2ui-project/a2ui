/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {validateRecursionAndPaths} from '@a2ui/web_core/validation';
import {A2uiValidator} from './a2ui_validator.js';
import authoredBasicCatalog from '../../../../../catalogs/basic/v1/catalog.json' with {type: 'json'};

const BASIC = basicCatalog.id;
const OTHER = 'example.com:other';

/** A catalog schema with a single `Badge` component, in the shape the build writes. */
const OTHER_CATALOG = {
  catalogId: OTHER,
  components: {
    Badge: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        component: {const: 'Badge'},
        label: {type: 'string'},
      },
      required: ['id', 'component', 'label'],
    },
  },
};

function basicValidator() {
  return new A2uiValidator({
    contractVersion: '1.0',
    catalogs: {[BASIC]: basicCatalog.validationSchema},
  });
}

function createSurface(components: unknown[], catalogId: string | undefined = BASIC) {
  return {version: '1.0', createSurface: {surfaceId: 'main', catalogId, components}};
}

function updateComponents(surfaceId: string, components: unknown[]) {
  return {version: '1.0', updateComponents: {surfaceId, components}};
}

const TEXT = {id: 'title', component: 'Text', text: 'Revenue'};

describe('A2uiValidator', () => {
  it('accepts valid messages', () => {
    const result = basicValidator().validate([
      createSurface([
        {id: 'root', component: 'Column', children: ['title', 'value']},
        TEXT,
        {id: 'value', component: 'Text', text: {'@path': '/revenue'}, variant: 'caption'},
      ]),
      {version: '1.0', updateDataModel: {surfaceId: 'main', value: {revenue: '$1M'}}},
      {version: '1.0', deleteSurface: {surfaceId: 'main'}},
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('names the component, its type and the property of an invalid component', () => {
    const result = basicValidator().validate([
      createSurface([{id: 'kpi_value', component: 'Text', text: '42', variant: 'huge'}]),
    ]);
    assert.deepEqual(result, {
      ok: false,
      errors: [
        {
          messageIndex: 0,
          surfaceId: 'main',
          componentId: 'kpi_value',
          component: 'Text',
          property: 'variant',
          message:
            'Component "kpi_value" (Text): property "variant" must be one of "caption", "body"',
        },
      ],
    });
  });

  it('reports a missing required property', () => {
    const [error] = basicValidator().validate([
      createSurface([{id: 't', component: 'Text'}]),
    ]).errors;
    assert.equal(error.message, 'Component "t" (Text): property "text" is required');
  });

  it('validates function calls against the catalog functions', () => {
    const [error] = basicValidator().validate([
      createSurface([
        {id: 't', component: 'Text', text: {'@call': 'formatString', args: {value: 3}}},
      ]),
    ]).errors;
    assert.equal(error.property, 'text.args.value');
  });

  it('rejects a component id that is not a UAX #31 identifier', () => {
    const result = basicValidator().validate([
      createSurface([{id: 'issue-body', component: 'Text', text: 'Body'}]),
    ]);
    assert.deepEqual(result, {
      ok: false,
      errors: [
        {
          messageIndex: 0,
          surfaceId: 'main',
          componentId: 'issue-body',
          component: 'Text',
          message:
            'Component "issue-body": id must be a valid identifier (UAX #31): a letter or "_" followed by letters, digits or "_", such as "issue_body".',
        },
      ],
    });
  });

  it('suggests an identifier for an id that starts with a digit', () => {
    const [error] = basicValidator().validate([
      createSurface([{id: '1st item', component: 'Text', text: 'First'}]),
    ]).errors;
    assert.match(error.message, /such as "_1st_item"\.$/);
  });

  it('accepts non-ASCII component ids', () => {
    const result = basicValidator().validate([
      createSurface([
        {id: 'root', component: 'Column', children: ['título']},
        {id: 'título', component: 'Text', text: 'Hola'},
      ]),
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('rejects function and argument names that are not UAX #31 identifiers', () => {
    const errors = basicValidator()
      .validate([
        createSurface([
          {
            id: 't',
            component: 'Text',
            text: {'@call': 'format-string', args: {'the-value': {'@call': '@index'}}},
          },
        ]),
      ])
      .errors.map(error => error.message);
    assert.deepEqual(errors, [
      'Component "t": property "text" calls "format-string", which is not a valid function name (UAX #31).',
      'Component "t": property "text" passes argument "the-value" to "format-string", which is not a valid argument name (UAX #31).',
    ]);
  });

  it('rejects a component id repeated within one message', () => {
    const result = basicValidator().validate([
      createSurface([
        {id: 'root', component: 'Column', children: ['suggest']},
        {id: 'suggest', component: 'Text', text: 'One'},
        {id: 'suggest', component: 'Text', text: 'Two'},
        {id: 'suggest', component: 'Text', text: 'Three'},
      ]),
    ]);
    assert.deepEqual(result, {
      ok: false,
      errors: [
        {
          messageIndex: 0,
          surfaceId: 'main',
          componentId: 'suggest',
          message:
            'Component "suggest" is defined more than once in message 0 for surface "main". Component IDs must be unique within a message.',
        },
      ],
    });
  });

  it('accepts a component id repeated across messages', () => {
    const result = basicValidator().validate([
      createSurface([{id: 'root', component: 'Text', text: 'Loading'}]),
      updateComponents('main', [{id: 'root', component: 'Text', text: 'Done'}]),
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('rejects a surface without a root component', () => {
    const result = basicValidator().validate([createSurface([TEXT])]);
    assert.deepEqual(result, {
      ok: false,
      errors: [
        {
          messageIndex: 0,
          surfaceId: 'main',
          message:
            'Surface "main" has no "root" component. The app renders the component with ID "root" first, so every surface with components needs one.',
        },
      ],
    });
  });

  it('checks a surface once all the messages apply', () => {
    const result = basicValidator().validate([
      createSurface([TEXT]),
      updateComponents('main', [{id: 'root', component: 'Column', children: ['title']}]),
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('rejects a reference to a component the surface does not define', () => {
    const result = basicValidator().validate([
      createSurface([
        {id: 'root', component: 'Column', children: ['title', 'missing']},
        TEXT,
        {
          id: 'tabs',
          component: 'Tabs',
          tabs: [{title: 'One', child: 'gone'}],
        },
      ]),
    ]);
    assert.deepEqual(
      result.errors.map(({componentId, property, message}) => ({componentId, property, message})),
      [
        {
          componentId: 'root',
          property: 'children[1]',
          message:
            'Component "root" (Column): property "children[1]" refers to "missing", which no component of surface "main" defines.',
        },
        {
          componentId: 'tabs',
          property: 'tabs[0].child',
          message:
            'Component "tabs" (Tabs): property "tabs[0].child" refers to "gone", which no component of surface "main" defines.',
        },
      ],
    );
  });

  it('rejects a component that refers to itself', () => {
    const [error] = basicValidator().validate([
      createSurface([{id: 'root', component: 'Card', child: 'root'}]),
    ]).errors;
    assert.equal(
      error.message,
      'Component "root" (Card): property "child" refers to the component itself.',
    );
  });

  it('rejects a cycle of component references', () => {
    const [error] = basicValidator().validate([
      createSurface([
        {id: 'root', component: 'Column', children: ['a']},
        {id: 'a', component: 'Card', child: 'b'},
        {id: 'b', component: 'Card', child: 'a'},
      ]),
    ]).errors;
    assert.equal(
      error.message,
      'Surface "main" has a cycle of component references: "a" -> "b" -> "a".',
    );
  });

  it('accepts components the root does not reach', () => {
    const result = basicValidator().validate([
      createSurface([{id: 'root', component: 'Text', text: 'Hi'}, TEXT]),
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('does not check the components of a surface created earlier', () => {
    const validator = basicValidator();
    validator.remember([createSurface([{id: 'root', component: 'Text', text: 'Hi'}])]);
    const result = validator.validate([
      updateComponents('main', [{id: 'more', component: 'Column', children: ['elsewhere']}]),
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('does not check a surface deleted by the same messages', () => {
    const result = basicValidator().validate([
      createSurface([TEXT]),
      {version: '1.0', deleteSurface: {surfaceId: 'main'}},
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('rejects creating a surface twice', () => {
    const surface = createSurface([{id: 'root', component: 'Text', text: 'Hi'}]);
    const result = basicValidator().validate([surface, surface]);
    assert.deepEqual(result, {
      ok: false,
      errors: [
        {
          messageIndex: 1,
          surfaceId: 'main',
          message:
            'Message 1 (createSurface): surface "main" already exists. Delete it with a deleteSurface message first, or update it with updateComponents.',
        },
      ],
    });
  });

  it('accepts creating a surface again after deleting it', () => {
    const surface = createSurface([{id: 'root', component: 'Text', text: 'Hi'}]);
    const result = basicValidator().validate([
      surface,
      {version: '1.0', deleteSurface: {surfaceId: 'main'}},
      surface,
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('rejects a data model path that is not a JSON Pointer', () => {
    const result = basicValidator().validate([
      {version: '1.0', updateDataModel: {surfaceId: 'main', path: 'user/name', value: 'Ada'}},
    ]);
    assert.deepEqual(result, {
      ok: false,
      errors: [
        {
          messageIndex: 0,
          surfaceId: 'main',
          property: 'path',
          message:
            'Message 0 (updateDataModel): path "user/name" must be a JSON Pointer that starts with "/", such as "/user/name".',
        },
      ],
    });
  });

  it('rejects message kinds the app does not accept', () => {
    const [error] = basicValidator().validate([
      {
        version: '1.0',
        callRendererFunction: {surfaceId: 'main', callId: 'c1', name: 'now', args: {}},
      },
    ]).errors;
    assert.equal(
      error.message,
      'Message 0 (callRendererFunction): the app accepts only "createSurface", "updateComponents", "updateDataModel", "deleteSurface" messages.',
    );
  });

  describe('with deeply nested function calls', () => {
    /** The basic catalog plus generated functions, 50 in all, each taking any dynamic value. */
    function wideCatalog() {
      const schema = structuredClone(basicCatalog.validationSchema) as {
        functions: Record<string, unknown>;
        $defs: {anyFunction: {oneOf: unknown[]}};
      };
      for (let i = Object.keys(schema.functions).length; i < 50; i++) {
        schema.functions[`fn${i}`] = {
          type: 'object',
          properties: {
            '@call': {const: `fn${i}`},
            args: {
              type: 'object',
              properties: {value: {$ref: '#/$defs/DynamicValue'}},
              required: ['value'],
              unevaluatedProperties: false,
            },
          },
          required: ['@call', 'args'],
        };
        schema.$defs.anyFunction.oneOf.push({$ref: `#/functions/fn${i}`});
      }
      return new A2uiValidator({contractVersion: '1.0', catalogs: {[BASIC]: schema}});
    }

    /** `fn20(fn21(...fn<20 + depth - 1>(leaf)))`, as the text of a Text component. */
    function nestedText(depth: number, leaf: unknown) {
      let value = leaf;
      for (let i = depth - 1; i >= 0; i--) {
        value = {'@call': `fn${20 + i}`, args: {value}};
      }
      return createSurface([{id: 'root', component: 'Text', text: value}]);
    }

    function timed<T>(run: () => T): {result: T; ms: number} {
      const start = performance.now();
      const result = run();
      return {result, ms: performance.now() - start};
    }

    it('validates calls nested 6 deep quickly', () => {
      const validator = wideCatalog();
      const {result, ms} = timed(() => validator.validate([nestedText(6, {'@path': '/x'})]));
      assert.deepEqual(result, {ok: true, errors: []});
      assert.ok(ms < 200, `took ${ms.toFixed(0)} ms`);
    });

    it('reports an invalid argument nested 5 deep quickly', () => {
      const validator = wideCatalog();
      const leaf = {'@call': 'formatNumber', args: {value: 'many'}};
      const {result, ms} = timed(() => validator.validate([nestedText(4, leaf)]));
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].property, `text${'.args.value'.repeat(5)}`);
      assert.match(result.errors[0].message, /must be a number$/);
      assert.ok(ms < 200, `took ${ms.toFixed(0)} ms`);
    });

    it('names an unknown function nested 5 deep', () => {
      const validator = wideCatalog();
      const leaf = {'@call': 'nope', args: {value: 1}};
      const {result, ms} = timed(() => validator.validate([nestedText(4, leaf)]));
      assert.deepEqual(
        result.errors.map(({property, message}) => ({property, message})),
        [
          {
            property: `text${'.args.value'.repeat(4)}.@call`,
            message: `Component "root" (Text): property "text${'.args.value'.repeat(4)}.@call" is "nope", which is not a function of the catalog`,
          },
        ],
      );
      assert.ok(ms < 200, `took ${ms.toFixed(0)} ms`);
    });
  });

  describe('nesting limits', () => {
    it('rejects calls nested far too deep without validating them', () => {
      let value: unknown = {'@path': '/x'};
      for (let i = 0; i < 40; i++) value = {'@call': 'formatString', args: {value}};
      const start = performance.now();
      const [error] = basicValidator().validate([
        createSurface([{id: 'root', component: 'Text', text: value}]),
      ]).errors;
      assert.match(
        error.message,
        /is nested more than 50 levels deep in its message, which the app does not allow\.$/,
      );
      assert.ok(performance.now() - start < 200);
    });

    /** `not(not(...required(/x)))` with `calls` calls in all. */
    function notChain(calls: number): unknown {
      let value: unknown = {'@call': 'required', args: {value: {'@path': '/x'}}};
      for (let i = 1; i < calls; i++) value = {'@call': 'not', args: {value}};
      return value;
    }

    function buttonWithCheck(condition: unknown) {
      return createSurface([
        {
          id: 'root',
          component: 'Button',
          child: 'label',
          action: {event: {name: 'pay'}},
          '@checks': [{condition, message: 'Not allowed'}],
        },
        {id: 'label', component: 'Text', text: 'Pay'},
      ]);
    }

    /** Whether web_core's checker, which the app runs on every message, accepts `message`. */
    function appAccepts(message: unknown): boolean {
      try {
        validateRecursionAndPaths(message);
        return true;
      } catch {
        return false;
      }
    }

    it('accepts function calls nested 6 deep', () => {
      const message = buttonWithCheck(notChain(6));
      assert.equal(appAccepts(message), true);
      assert.deepEqual(basicValidator().validate([message]), {ok: true, errors: []});
    });

    /** A Text whose `text` is a value nested in arrays so that its innermost value is `depth` below the message. */
    function deepText(depth: number) {
      // The message, `createSurface`, `components`, the component and `text` take 4 levels.
      let value: unknown = 'leaf';
      for (let i = 4; i < depth; i++) value = [value];
      return createSurface([{id: 'root', component: 'Text', text: value}]);
    }

    it('accepts values nested 50 levels below the message', () => {
      const message = deepText(50);
      assert.equal(appAccepts(message), true);
      const messages = basicValidator()
        .validate([message])
        .errors.map(error => error.message);
      assert.ok(
        messages.every(text => !text.includes('levels deep')),
        messages.join(),
      );
    });

    it('rejects values nested more than 50 levels below the message', () => {
      const message = deepText(51);
      assert.equal(appAccepts(message), false);
      const [error] = basicValidator().validate([message]).errors;
      assert.equal(error.componentId, 'root');
      assert.equal(error.property, `text${'[0]'.repeat(47)}`);
      assert.equal(
        error.message,
        `Component "root" (Text): property "text${'[0]'.repeat(47)}" is nested more than 50 levels deep in its message, which the app does not allow.`,
      );
    });
  });

  it('accepts the system @index function', () => {
    const result = basicValidator().validate([
      createSurface([
        {
          id: 'root',
          component: 'Text',
          text: {'@call': 'formatString', args: {value: {'@call': '@index'}}},
        },
      ]),
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('ignores a discriminator that does not fit its alternatives', () => {
    const schema = structuredClone(OTHER_CATALOG) as Record<string, unknown>;
    schema['$defs'] = {
      anyThing: {
        oneOf: [{type: 'string'}, {type: 'number'}],
        discriminator: {propertyName: 'kind'},
      },
    };
    const validator = new A2uiValidator({contractVersion: '1.0', catalogs: {[OTHER]: schema}});
    const result = validator.validate([
      createSurface([{id: 'root', component: 'Badge', label: 'New'}], OTHER),
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('rejects a component type the catalog does not define', () => {
    const [error] = basicValidator().validate([
      createSurface([{id: 'c', component: 'Chart'}]),
    ]).errors;
    assert.equal(
      error.message,
      `Component "c" (Chart): catalog "${BASIC}" has no component named "Chart".`,
    );
  });

  it('rejects a surface whose catalog the app does not include', () => {
    const [error] = basicValidator().validate([
      createSurface([TEXT], 'example.com:missing'),
    ]).errors;
    assert.equal(
      error.message,
      `Surface "main" uses catalog "example.com:missing", which the app does not include. The app includes: "${BASIC}".`,
    );
  });

  it('rejects a component whose @catalogId the app does not include', () => {
    const [error] = basicValidator().validate([
      createSurface([{...TEXT, '@catalogId': 'example.com:missing'}]),
    ]).errors;
    assert.match(error.message, /catalog "example.com:missing" is not included in the app/);
  });

  it('rejects a message that is not a server-to-client message', () => {
    const result = basicValidator().validate([{version: '1.0', hello: {}}, 'text']);
    assert.deepEqual(
      result.errors.map(error => error.message),
      [
        'Message 0 is not an A2UI v1.0 server-to-client message: it must have one of "createSurface", "updateComponents", "updateDataModel", "deleteSurface", "callRendererFunction", "agentFunctionResponse".',
        'Message 1 must be an object.',
      ],
    );
  });

  it('rejects an invalid envelope', () => {
    const result = basicValidator().validate([
      {version: '0.9', createSurface: {catalogId: BASIC, extra: true}},
    ]);
    assert.deepEqual(
      result.errors.map(error => error.message),
      [
        'Message 0 (createSurface): property "version" must be "1.0"',
        'Message 0 (createSurface): property "createSurface.surfaceId" is required',
        'Message 0 (createSurface): property "createSurface.extra" is not allowed',
      ],
    );
  });

  it('rejects messages that are not an array', () => {
    assert.equal(basicValidator().validate({}).ok, false);
  });

  it('validates updates against the catalog of a surface created in the same list', () => {
    const validator = new A2uiValidator({
      contractVersion: '1.0',
      catalogs: {[BASIC]: basicCatalog.validationSchema, [OTHER]: OTHER_CATALOG},
    });
    const result = validator.validate([
      createSurface([{id: 'root', component: 'Badge', label: 'New'}], OTHER),
      updateComponents('main', [{id: 'root', component: 'Badge', label: 1}]),
    ]);
    assert.deepEqual(
      result.errors.map(error => error.message),
      ['Component "root" (Badge): property "label" must be a string'],
    );
  });

  it('validates updates against the catalog of a surface created in an earlier call', () => {
    const validator = new A2uiValidator({
      contractVersion: '1.0',
      catalogs: {[BASIC]: basicCatalog.validationSchema, [OTHER]: OTHER_CATALOG},
    });
    const create = [createSurface([{id: 'root', component: 'Badge', label: 'New'}], OTHER)];
    const update = [updateComponents('main', [{id: 'root', component: 'Badge', label: 'Old'}])];
    assert.match(
      validator.validate(update).errors[0].message,
      /the catalog of surface "main" is unknown/,
    );
    validator.remember(create);
    assert.deepEqual(validator.validate(update), {ok: true, errors: []});
  });

  it('forgets the catalog of a deleted surface', () => {
    const validator = new A2uiValidator({
      contractVersion: '1.0',
      catalogs: {[BASIC]: basicCatalog.validationSchema, [OTHER]: OTHER_CATALOG},
    });
    validator.remember([createSurface([], OTHER)]);
    validator.remember([{version: '1.0', deleteSurface: {surfaceId: 'main'}}]);
    const update = [updateComponents('main', [{id: 'root', component: 'Badge', label: 'Old'}])];
    assert.equal(validator.validate(update).ok, false);
  });

  it('falls back to the only catalog for a surface it does not know', () => {
    const result = basicValidator().validate([updateComponents('unknown', [TEXT])]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('does not remember surfaces while validating', () => {
    const validator = new A2uiValidator({
      contractVersion: '1.0',
      catalogs: {[BASIC]: basicCatalog.validationSchema, [OTHER]: OTHER_CATALOG},
    });
    validator.validate([createSurface([], OTHER)]);
    const update = [updateComponents('main', [{id: 'root', component: 'Badge', label: 'Old'}])];
    assert.equal(validator.validate(update).ok, false);
  });

  it('resolves references to the specification in an authored catalog schema', () => {
    const validator = new A2uiValidator({
      contractVersion: '1.0',
      catalogs: {[BASIC]: authoredBasicCatalog},
    });
    assert.equal(validator.validate([createSurface([{...TEXT, id: 'root'}])]).ok, true);
    const [error] = validator.validate([
      createSurface([{id: 't', component: 'Text', text: 4}]),
    ]).errors;
    assert.equal(
      error.message,
      'Component "t" (Text): property "text" must be a string or an object',
    );
  });

  it('rejects a catalog schema without components', () => {
    assert.throws(
      () => new A2uiValidator({contractVersion: '1.0', catalogs: {[OTHER]: {}}}),
      /The schema of catalog "example.com:other" has no "components" object/,
    );
  });

  it('rejects a catalog schema with an unresolvable reference', () => {
    const catalog = {components: {Badge: {$ref: '#/$defs/Missing'}}};
    assert.throws(
      () => new A2uiValidator({contractVersion: '1.0', catalogs: {[OTHER]: catalog}}),
      /The schema of catalog "example.com:other" is invalid/,
    );
  });
});
