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
import {afterEach, describe, it} from 'node:test';

import {
  basicCatalog,
  createFunctionImplementation,
  type A2uiMessage,
  type FunctionImplementation,
} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

import {SurfaceHarnessError, createSurfaceHarness} from './harness.js';
import type {SurfaceHarness, SurfaceHarnessPlugin} from './types.js';

/** A surface whose rows are a `List` template bound to `/entries`. */
const listPayload = [
  {version: 'v0.9', createSurface: {surfaceId: 'files', catalogId: basicCatalog.id}},
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: 'files',
      path: '/',
      value: {
        heading: 'Pick a file',
        query: '',
        entries: [{name: 'a.md'}, {name: 'docs'}],
      },
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'files',
      components: [
        {
          id: 'root',
          component: 'Column',
          children: ['heading', 'query_field', 'entry_list', 'static_text'],
        },
        {id: 'heading', component: 'Text', text: {path: '/heading'}},
        {id: 'query_field', component: 'TextField', label: 'Query', value: {path: '/query'}},
        {
          id: 'entry_list',
          component: 'List',
          children: {componentId: 'entry_row', path: '/entries'},
        },
        {id: 'entry_row', component: 'Row', children: ['entry_button']},
        {
          id: 'entry_button',
          component: 'Button',
          child: 'entry_name',
          action: {event: {name: 'open', context: {file: {path: 'name'}}}},
        },
        {id: 'entry_name', component: 'Text', text: {path: 'name'}},
        {
          id: 'orphan',
          component: 'Button',
          child: 'orphan_label',
          action: {event: {name: 'orphan_pressed', context: {from: {path: '/heading'}}}},
        },
        {id: 'orphan_label', component: 'Text', text: 'never shown'},
        {id: 'static_text', component: 'Text', text: 'static'},
      ],
    },
  },
] as unknown as A2uiMessage[];

describe('createSurfaceHarness', () => {
  let h: SurfaceHarness | undefined;

  afterEach(() => {
    h?.dispose();
    h = undefined;
  });

  describe('reading the surface', () => {
    it('resolves bound props and follows data model writes', async () => {
      h = await createSurfaceHarness({messages: listPayload});

      assert.deepStrictEqual(h.surfaces(), ['files']);
      assert.strictEqual(h.prop('heading', 'text'), 'Pick a file');
      assert.strictEqual(h.component('heading').properties['text'].path, '/heading');

      await h.setData('/heading', 'Choose');

      assert.strictEqual(h.data('/heading'), 'Choose');
      assert.strictEqual(h.prop('heading', 'text'), 'Choose');
    });

    it('lists static children and one scope per template item', async () => {
      h = await createSurfaceHarness({messages: listPayload});

      assert.deepStrictEqual(
        h.children('root').map(c => c.id),
        ['heading', 'query_field', 'entry_list', 'static_text'],
      );
      assert.deepStrictEqual(h.children('entry_list'), [
        {id: 'entry_row', scope: '/entries/0'},
        {id: 'entry_row', scope: '/entries/1'},
      ]);
      assert.strictEqual(h.prop('entry_name', 'text', {scope: '/entries/1'}), 'docs');
    });

    it('tells reachable components from orphans, by scope', async () => {
      h = await createSurfaceHarness({messages: listPayload});

      assert.ok(h.rendered('heading'));
      assert.ok(h.rendered('entry_button'));
      assert.ok(h.rendered('entry_button', {scope: '/entries/0'}));
      assert.ok(!h.rendered('entry_button', {scope: '/entries/5'}));
      assert.ok(h.exists('orphan'));
      assert.ok(!h.rendered('orphan'));
      assert.ok(!h.rendered('no_such_component'));
    });
  });

  describe('interacting', () => {
    it('records event actions with context resolved in the clicked scope', async () => {
      h = await createSurfaceHarness({messages: listPayload});

      await h.click('entry_button', {scope: '/entries/1'});
      await h.click('orphan');

      assert.deepStrictEqual(
        h.actions.map(a => [a.name, a.sourceComponentId, a.context]),
        [
          ['open', 'entry_button', {file: 'docs'}],
          ['orphan_pressed', 'orphan', {from: 'Pick a file'}],
        ],
      );
      assert.strictEqual(h.actions[0].surfaceId, 'files');
    });

    it('writes user input through a bound value', async () => {
      h = await createSurfaceHarness({messages: listPayload});

      await h.setValue('query_field', 'readme');

      assert.strictEqual(h.data('/query'), 'readme');
      assert.strictEqual(h.prop('query_field', 'value'), 'readme');
    });

    it('applies streamed messages through process', async () => {
      h = await createSurfaceHarness({messages: listPayload});

      await h.process({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'files',
          components: [{id: 'static_text', component: 'Text', text: 'replaced'}],
        },
      } as A2uiMessage);

      assert.strictEqual(h.prop('static_text', 'text'), 'replaced');
    });
  });

  describe('plugins and functions', () => {
    const shout: FunctionImplementation = createFunctionImplementation(
      {name: 'shout', returnType: 'string' as const, schema: z.object({text: z.string()})},
      args => `${args.text}!`,
    );
    const shoutingText = (catalogId: string) =>
      [
        {version: 'v0.9', createSurface: {surfaceId: 's', catalogId}},
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [
              {id: 'root', component: 'Text', text: {call: 'shout', args: {text: 'hi'}}},
            ],
          },
        },
      ] as unknown as A2uiMessage[];

    it('adds passed functions to every synthesized catalog', async () => {
      h = await createSurfaceHarness({
        messages: shoutingText('https://example.com/custom.json'),
        functions: [shout],
      });

      assert.strictEqual(h.prop('root', 'text'), 'hi!');
    });

    it('registers plugin functions and catalog ids, and waits for plugin work', async () => {
      let settled = 0;
      let pendingChecks = 0;
      const plugin: SurfaceHarnessPlugin = {
        name: 'shouter',
        catalogIds: ['https://example.com/plugin.json'],
        functions: processor => {
          assert.ok(processor, 'plugin receives a processor handle');
          return [shout];
        },
        pending: () => {
          pendingChecks++;
          return false;
        },
        settle: async () => {
          settled++;
        },
      };
      h = await createSurfaceHarness({
        messages: shoutingText('https://example.com/plugin.json'),
        plugins: [plugin],
      });

      assert.strictEqual(h.prop('root', 'text'), 'hi!');
      assert.ok(settled > 0, 'settle ran');
      assert.ok(pendingChecks > 0, 'pending was consulted');
    });

    it('hands plugin functions a processor that works once messages flow', async () => {
      const plugin: SurfaceHarnessPlugin = {
        functions: processor => [
          createFunctionImplementation(
            {name: 'surfaceCount', returnType: 'number' as const, schema: z.object({})},
            () => (processor.model.getSurface('s') ? 1 : 0),
          ),
        ],
      };
      h = await createSurfaceHarness({
        messages: [
          {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: basicCatalog.id}},
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 's',
              components: [{id: 'root', component: 'Text', text: {call: 'surfaceCount', args: {}}}],
            },
          },
        ] as unknown as A2uiMessage[],
        plugins: [plugin],
      });

      assert.strictEqual(h.prop('root', 'text'), 1);
    });
  });

  describe('failure reporting', () => {
    it('fails an interaction that makes the surface report an error', async () => {
      h = await createSurfaceHarness({
        messages: [
          {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: basicCatalog.id}},
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 's',
              components: [
                {
                  id: 'root',
                  component: 'Button',
                  child: 'label',
                  action: {functionCall: {call: 'no_such_function', args: {}}},
                },
                {id: 'label', component: 'Text', text: 'Go'},
              ],
            },
          },
        ] as unknown as A2uiMessage[],
      });

      await assert.rejects(
        () => h!.click('root'),
        (error: unknown) => {
          assert.ok(error instanceof SurfaceHarnessError);
          assert.match(error.message, /click\('root'\)/);
          assert.match(error.message, /no_such_function/);
          return true;
        },
      );
      assert.strictEqual(h.errors.length, 1);

      await h.click('root', {throwOnError: false});
      assert.strictEqual(h.errors.length, 2);
    });

    it('names the component when an id is not on the surface', async () => {
      h = await createSurfaceHarness({messages: listPayload});

      assert.throws(() => h!.prop('nope', 'text'), /Component 'nope' is not on surface 'files'/);
      await assert.rejects(() => h!.click('nope'), /Component 'nope' is not on surface 'files'/);
    });

    it('refuses to click a component without an action', async () => {
      h = await createSurfaceHarness({messages: listPayload});

      await assert.rejects(() => h!.click('heading'), /declares no action/);
    });

    it('refuses to type into a value that is not bound to the data model', async () => {
      h = await createSurfaceHarness({messages: listPayload});

      await h.process({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'files',
          components: [{id: 'query_field', component: 'TextField', label: 'Q', value: 'fixed'}],
        },
      } as unknown as A2uiMessage);

      await assert.rejects(() => h!.setValue('query_field', 'typed'), /does not bind 'value'/);
    });

    it('rejects v1.0 payloads with a clear message', async () => {
      await assert.rejects(
        () =>
          createSurfaceHarness({
            messages: [
              {version: 'v1.0', createSurface: {surfaceId: 's'}},
            ] as unknown as A2uiMessage[],
          }),
        /supports protocol v0.9 and v0.9.1/,
      );
    });
  });
});
