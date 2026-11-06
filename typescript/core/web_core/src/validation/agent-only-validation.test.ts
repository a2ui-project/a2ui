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

import {Catalog, ComponentApi} from '../catalog/types.js';
import {BASIC_COMPONENTS} from '../catalogs/basic/v1/components/basic_components.js';
import {BASIC_FUNCTIONS} from '../catalogs/basic/v1/functions/basic_functions.js';
import {A2uiValidationError} from '../errors.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {STRICT_VALIDATION} from './integrity-checker.js';
import {PayloadValidator} from './payload-validator.js';

const ARCANA_ID = 'https://example.com/arcana.json';
const BASIC_ID = 'https://example.com/basic.json';
const AGENT_ONLY =
  /Function 'getMoonPhase' cannot be called by renderer \(allowedCallers is agentOnly\)/;

function fn(name: string, allowedCallers: string): Record<string, unknown> {
  return {
    type: 'object',
    allowedCallers,
    properties: {
      '@call': {const: name},
      args: {
        type: 'object',
        // Dynamic, so that a call may be nested in it.
        properties: {date: {$ref: 'common_types.json#/$defs/DynamicString'}},
        additionalProperties: false,
      },
    },
    returnType: 'string',
    required: ['@call'],
  };
}

/** A catalog with a Label and Button, an agentOnly function and a rendererOrAgent one. */
const ARCANA = Catalog.fromJson({
  catalogId: ARCANA_ID,
  protocolVersion: '1.0',
  components: {
    Label: {
      type: 'object',
      properties: {
        component: {const: 'Label'},
        text: {$ref: 'common_types.json#/$defs/DynamicString'},
      },
      required: ['component', 'text'],
    },
    Button: {
      type: 'object',
      properties: {
        component: {const: 'Button'},
        action: {$ref: 'common_types.json#/$defs/Action'},
        checks: {type: 'array', items: {$ref: 'common_types.json#/$defs/CheckRule'}},
      },
      required: ['component'],
    },
  },
  functions: {
    getMoonPhase: fn('getMoonPhase', 'agentOnly'),
    getTide: fn('getTide', 'rendererOrAgent'),
  },
});
const BASIC = new Catalog<ComponentApi>(BASIC_ID, '1.0', BASIC_COMPONENTS, BASIC_FUNCTIONS);

/** Asserts that `fn` throws the agentOnly error, at `path` when one is given. */
function assertAgentOnly(fn: () => unknown, path?: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof A2uiValidationError, String(err));
    assert.match(err.message, AGENT_ONLY);
    if (path !== undefined) assert.strictEqual(err.path, path);
    return true;
  });
}

describe('agentOnly functions in components', () => {
  function validate(component: Record<string, unknown>): void {
    new PayloadValidator(ARCANA as never, STRICT_VALIDATION).validateComponent(component);
  }

  it('rejects one in a property binding', () => {
    assertAgentOnly(
      () => validate({id: 'root', component: 'Label', text: {'@call': 'getMoonPhase', args: {}}}),
      '/text',
    );
  });

  it('rejects one in an action', () => {
    assertAgentOnly(
      () =>
        validate({
          id: 'root',
          component: 'Button',
          action: {functionCall: {'@call': 'getMoonPhase'}},
        }),
      '/action/functionCall',
    );
  });

  it('rejects one in a check', () => {
    assertAgentOnly(
      () =>
        validate({
          id: 'root',
          component: 'Button',
          checks: [{condition: {'@call': 'getMoonPhase'}, message: 'Too dark'}],
        }),
      '/checks/0/condition',
    );
  });

  it('rejects one nested in another call', () => {
    assertAgentOnly(
      () =>
        validate({
          id: 'root',
          component: 'Label',
          text: {'@call': 'getTide', args: {date: {'@call': 'getMoonPhase'}}},
        }),
      '/text/args/date',
    );
  });

  it('accepts a rendererOrAgent function in a binding', () => {
    assert.doesNotThrow(() =>
      validate({id: 'root', component: 'Label', text: {'@call': 'getTide', args: {date: 'today'}}}),
    );
  });
});

describe('agentOnly functions of another catalog in components', () => {
  function process(...components: Record<string, unknown>[]): void {
    const processor = new MessageProcessor<ComponentApi>([BASIC, ARCANA as never], undefined, {
      validationConfig: STRICT_VALIDATION,
    });
    processor.processMessages([
      {version: '1.0', createSurface: {surfaceId: 's', catalogId: BASIC_ID}},
      {version: '1.0', updateComponents: {surfaceId: 's', components: components as never}},
    ]);
  }

  it('rejects one in a property binding', () => {
    assertAgentOnly(
      () =>
        process({
          id: 'root',
          component: 'Text',
          text: {'@call': 'getMoonPhase', catalogId: ARCANA_ID},
        }),
      '/components/0/text',
    );
  });

  it('rejects one in an action', () => {
    assertAgentOnly(
      () =>
        process(
          {
            id: 'root',
            component: 'Button',
            child: 'label',
            action: {functionCall: {'@call': 'getMoonPhase', catalogId: ARCANA_ID}},
          },
          {id: 'label', component: 'Text', text: 'Go'},
        ),
      '/components/0/action/functionCall',
    );
  });

  it('rejects one nested in a call to a function the renderer may call', () => {
    assertAgentOnly(
      () =>
        process({
          id: 'root',
          component: 'Text',
          text: {
            '@call': 'getTide',
            catalogId: ARCANA_ID,
            args: {date: {'@call': 'getMoonPhase', catalogId: ARCANA_ID}},
          },
        }),
      '/components/0/text/args/date',
    );
  });

  it('accepts a rendererOrAgent function', () => {
    assert.doesNotThrow(() =>
      process({id: 'root', component: 'Text', text: {'@call': 'getTide', catalogId: ARCANA_ID}}),
    );
  });
});
