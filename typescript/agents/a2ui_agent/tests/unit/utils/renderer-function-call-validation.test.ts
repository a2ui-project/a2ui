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

/**
 * Checks of v1.0 `callRendererFunction` messages by the agent's validators.
 */

import {describe, expect, it, vi} from 'vitest';
import {z} from 'zod';

import {
  A2uiValidationError,
  InMemoryCatalogProvider,
  RendererState,
  validatePayload,
} from '../../../src/index.js';
import {Catalog, CatalogApi, MessageProcessor} from '../../../src/internal/web-core.js';
import {BASIC_CATALOG_IDS, loadBasicCatalog} from '../../helpers/basic-catalogs.js';

type Message = Record<string, unknown>;

const BASIC = loadBasicCatalog('1.0');
const BASIC_ID = BASIC_CATALOG_IDS['1.0'];
const CUSTOM_ID = 'https://example.com/arcana.json';
const CUSTOM = new InMemoryCatalogProvider(
  {
    catalogId: CUSTOM_ID,
    components: {
      Dummy: {
        type: 'object',
        properties: {component: {const: 'Dummy'}},
        required: ['component'],
      },
    },
    functions: {
      getMoonPhase: {
        type: 'object',
        allowedCallers: 'agentOnly',
        properties: {
          '@call': {const: 'getMoonPhase'},
          args: {
            type: 'object',
            properties: {date: {type: 'string'}},
            additionalProperties: false,
          },
          returnType: {const: 'string'},
        },
        required: ['@call'],
      },
      echo: {
        type: 'object',
        allowedCallers: 'rendererOrAgent',
        properties: {
          '@call': {const: 'echo'},
          // The TypeScript loader closes an object schema that leaves additionalProperties
          // unset, so the untyped arguments say so.
          args: {type: 'object', additionalProperties: true},
          returnType: {const: 'any'},
        },
        required: ['@call'],
      },
      describe: {
        type: 'object',
        allowedCallers: 'rendererOrAgent',
        properties: {
          '@call': {const: 'describe'},
          args: {
            type: 'object',
            properties: {text: {$ref: 'common_types.json#/$defs/DynamicString'}},
            additionalProperties: false,
          },
          returnType: {const: 'string'},
        },
        required: ['@call'],
      },
      scrollTo: {
        type: 'object',
        allowedCallers: 'rendererOrAgent',
        properties: {
          '@call': {const: 'scrollTo'},
          args: {
            type: 'object',
            properties: {id: {type: 'string'}},
            required: ['id'],
            additionalProperties: false,
          },
          returnType: {const: 'void'},
        },
        required: ['@call'],
      },
    },
  },
  '1.0',
).load();
const CATALOGS = [BASIC, CUSTOM];

function call(
  name: string,
  options: {catalogId?: string; args?: Record<string, unknown>; surfaceId?: string} = {},
): Message {
  const body: Message = {
    functionCallId: 'f1',
    callFunction: {
      '@call': name,
      catalogId: options.catalogId ?? CUSTOM_ID,
      args: options.args ?? {},
    },
  };
  if (options.surfaceId !== undefined) body.surfaceId = options.surfaceId;
  return {version: '1.0', callRendererFunction: body};
}

function create(surfaceId = 's'): Message {
  return {version: '1.0', createSurface: {surfaceId, catalogId: BASIC_ID}};
}

function del(surfaceId = 's'): Message {
  return {version: '1.0', deleteSurface: {surfaceId}};
}

const RECORDING_ID = 'https://example.com/recording.json';

/** A catalog whose `record` function appends its args to `calls`. */
function recordingCatalog(
  calls: unknown[],
  options: {
    allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
    requiresUserActivation?: boolean;
  } = {allowedCallers: 'rendererOrAgent'},
): CatalogApi {
  return new Catalog(
    RECORDING_ID,
    '1.0',
    [],
    [
      {
        name: 'record',
        returnType: 'void',
        schema: z.object({note: z.string().optional()}).strict(),
        execute: (args: Record<string, unknown>) => {
          calls.push(args);
        },
        allowedCallers: options.allowedCallers,
        requiresUserActivation: options.requiresUserActivation,
      },
    ],
  ) as unknown as CatalogApi;
}

describe('callRendererFunction validation', () => {
  it.each([
    ['rendererOrAgent', call('scrollTo', {args: {id: 'x'}})],
    ['agentOnly', call('getMoonPhase', {args: {date: '2026-11-05'}})],
    ['agentOnly without args', call('getMoonPhase')],
  ])('accepts a call the agent may make: %s', (_, message) => {
    expect(() => validatePayload(CATALOGS, [message])).not.toThrow();
  });

  it.each([
    [
      'unknown function',
      call('summonDragon', {catalogId: BASIC_ID}),
      /names 'summonDragon', which catalog .* does not declare/,
    ],
    [
      'wrong arg type',
      call('getMoonPhase', {args: {date: 42}}),
      /does not match the arguments of 'getMoonPhase'.*Expected string, received number/,
    ],
    [
      'extra arg',
      call('getMoonPhase', {args: {date: 'd', bogus: 1}}),
      /does not match the arguments of 'getMoonPhase'.*bogus/,
    ],
    [
      'missing required arg',
      call('scrollTo'),
      /does not match the arguments of 'scrollTo'.*id: Expected string, received undefined/,
    ],
    [
      'renderer only',
      call('formatString', {catalogId: BASIC_ID, args: {value: 'hi'}}),
      /names 'formatString', which only the renderer may call \(allowedCallers is rendererOnly\)/,
    ],
    [
      'requires user activation (basic)',
      call('openUrl', {catalogId: BASIC_ID, args: {url: 'https://example.com'}}),
      /names 'openUrl', which only the renderer may call/,
    ],
    [
      'unregistered catalog',
      call('getMoonPhase', {catalogId: 'https://nope.example/catalog.json'}),
      /catalog 'https:\/\/nope\.example\/catalog\.json', which isn't one of the active catalogs/,
    ],
    [
      'system function',
      call('@index', {catalogId: CUSTOM_ID}),
      /names '@index', which catalog .* does not declare/,
    ],
  ])('rejects a call the renderer would refuse: %s', (_, message, match) => {
    expect(() => validatePayload(CATALOGS, [message])).toThrow(match);
    expect(() => validatePayload(CATALOGS, [message])).toThrow(A2uiValidationError);
  });

  it('rejects a call without a catalogId', () => {
    const message = call('scrollTo', {args: {id: 'x'}});
    delete ((message.callRendererFunction as Message).callFunction as Message).catalogId;
    expect(() => validatePayload(CATALOGS, [message])).toThrow(/catalogId/);
  });

  it('rejects a function that requires a user activation', () => {
    const catalog = recordingCatalog([], {
      allowedCallers: 'rendererOrAgent',
      requiresUserActivation: true,
    });
    expect(() => validatePayload([catalog], [call('record', {catalogId: RECORDING_ID})])).toThrow(
      /names 'record', which requires a user activation, and a call from the agent has none/,
    );
  });

  it('takes a function with no allowedCallers to be rendererOnly', () => {
    const catalog = recordingCatalog([], {});
    expect(() => validatePayload([catalog], [call('record', {catalogId: RECORDING_ID})])).toThrow(
      /allowedCallers is rendererOnly/,
    );
  });

  it('checks the arguments as written', () => {
    expect(() =>
      validatePayload(CATALOGS, [call('getMoonPhase', {args: {date: {'@path': '/date'}}})]),
    ).toThrow(/Expected string, received object/);
  });

  it.each([
    ['data binding', {'@path': '/name'}],
    ['call', {'@call': 'scrollTo', args: {id: 'x'}}],
  ])('accepts an argument the renderer resolves: %s', (_, text) => {
    expect(() => validatePayload(CATALOGS, [call('describe', {args: {text}})])).not.toThrow();
  });

  it('checks the calls an argument schema admits', () => {
    expect(() =>
      validatePayload(CATALOGS, [call('describe', {args: {text: {'@call': 'summonDragon'}}})]),
    ).toThrow(A2uiValidationError);
  });

  it.each([
    ['same catalog', {'@call': 'scrollTo', args: {id: 'x'}}],
    ['another catalog', {'@call': 'formatString', catalogId: BASIC_ID, args: {value: 'hi'}}],
    ['system function in a list', [{'@call': '@index'}]],
  ])('accepts a call nested in untyped arguments: %s', (_, value) => {
    expect(() => validatePayload(CATALOGS, [call('echo', {args: {value}})])).not.toThrow();
  });

  it.each([
    ['unknown function', {'@call': 'summonDragon'}, /Unrecognized function 'summonDragon'/],
    [
      'bad args',
      {'@call': 'scrollTo', args: {}},
      /holds a call to 'scrollTo' that does not match the arguments of 'scrollTo'/,
    ],
    [
      'agent only',
      {'@call': 'getMoonPhase'},
      /holds a call to 'getMoonPhase' that the renderer can't make: Function 'getMoonPhase' cannot be called by renderer \(allowedCallers is agentOnly\)/,
    ],
    [
      'unregistered catalog',
      {'@call': 'formatString', catalogId: 'https://nope.example/c.json'},
      /names catalog 'https:\/\/nope\.example\/c\.json', which isn't one of the active catalogs/,
    ],
    [
      'system function with catalog',
      {'@call': '@index', catalogId: CUSTOM_ID},
      /system functions belong to no catalog/,
    ],
    ['unknown system function', {'@call': '@nope'}, /holds a call to '@nope' that is invalid/],
  ])('checks a call nested in the arguments: %s', (_, value, match) => {
    expect(() => validatePayload(CATALOGS, [call('echo', {args: {value}})])).toThrow(match);
  });

  it('does not run the function', async () => {
    const calls: unknown[] = [];
    const catalog = recordingCatalog(calls);
    const message = call('record', {catalogId: RECORDING_ID, args: {note: 'hi'}});

    validatePayload([catalog], [message]);
    const state = new RendererState([catalog]);
    state.apply([message]);
    state.transaction(() => state.apply([message]));
    // A call the processor received would run by now.
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(calls).toEqual([]);
  });

  it('does not run a function whose call it rejects', async () => {
    const calls: unknown[] = [];
    const catalog = recordingCatalog(calls, {allowedCallers: 'rendererOnly'});
    const message = call('record', {catalogId: RECORDING_ID, args: {note: 'hi'}});

    expect(() => validatePayload([catalog], [message])).toThrow(A2uiValidationError);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(calls).toEqual([]);
  });

  it('accepts a call on a surface the payload never named', () => {
    expect(() =>
      validatePayload(CATALOGS, [call('scrollTo', {args: {id: 'x'}, surfaceId: 's'})]),
    ).not.toThrow();
  });

  it('accepts a call on a surface the payload created', () => {
    expect(() =>
      validatePayload(CATALOGS, [create(), call('scrollTo', {args: {id: 'x'}, surfaceId: 's'})]),
    ).not.toThrow();
  });

  it('rejects a call on a surface the payload deleted', () => {
    expect(() =>
      validatePayload(CATALOGS, [
        create(),
        del(),
        call('scrollTo', {args: {id: 'x'}, surfaceId: 's'}),
      ]),
    ).toThrow(/names surface 's', which does not exist/);
  });

  it('rejects a call before the payload creates its surface', () => {
    expect(() =>
      validatePayload(CATALOGS, [call('scrollTo', {args: {id: 'x'}, surfaceId: 's'}), create()]),
    ).toThrow(/names surface 's', which does not exist/);
  });

  it('checks the call in a renderer state', () => {
    const state = new RendererState(CATALOGS);
    expect(() =>
      state.apply([call('formatString', {catalogId: BASIC_ID, args: {value: 'x'}})]),
    ).toThrow(/only the renderer may call/);
    expect(state.apply([call('scrollTo', {args: {id: 'x'}})])).toEqual([]);
  });

  it('requires the surface to exist in a renderer state', () => {
    const state = new RendererState(CATALOGS);
    const message = call('scrollTo', {args: {id: 'x'}, surfaceId: 's'});
    expect(() => state.apply([message])).toThrow(/names surface 's', which does not exist/);

    state.apply([create()]);
    expect(() => state.apply([message])).not.toThrow();
  });

  it('rolls back the messages before a rejected call', () => {
    const state = new RendererState(CATALOGS);
    expect(() => state.apply([create(), call('summonDragon')])).toThrow(/does not declare/);
    expect(state.surfaceIds).toEqual([]);
  });

  it('rolls back a transaction that a rejected call ends', () => {
    const state = new RendererState(CATALOGS);
    expect(() =>
      state.transaction(() => {
        state.apply([create()]);
        state.apply([call('getMoonPhase', {args: {date: 42}})]);
      }),
    ).toThrow(A2uiValidationError);
    expect(state.surfaceIds).toEqual([]);
  });

  it('rejects an agentOnly function bound into a component', () => {
    const payload = [
      {
        version: '1.0',
        createSurface: {surfaceId: 's', catalogId: BASIC_ID},
      },
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 's',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: {'@call': 'getMoonPhase', catalogId: CUSTOM_ID, args: {}},
            },
          ],
        },
      },
    ];
    expect(() => validatePayload(CATALOGS, payload)).toThrow(
      /Function 'getMoonPhase' cannot be called by renderer \(allowedCallers is agentOnly\)/,
    );
  });

  it("hands an accepted call to the renderer's processor, and only that one", () => {
    const calls: unknown[] = [];
    const catalog = recordingCatalog(calls);
    const processor = new MessageProcessor([catalog as never]);
    const handled: unknown[] = [];
    vi.spyOn(processor.rpc, 'handleCallRendererFunction').mockImplementation(message => {
      handled.push(message);
      return new Promise(() => {});
    });
    const state = RendererState.of(processor);

    expect(() =>
      state.apply([call('record', {catalogId: RECORDING_ID, args: {note: 42}})]),
    ).toThrow(/does not match the arguments of 'record'/);
    expect(handled).toEqual([]);

    state.apply([call('record', {catalogId: RECORDING_ID, args: {note: 'hi'}})]);
    expect(handled).toHaveLength(1);
  });
});
