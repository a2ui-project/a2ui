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

import {describe, expect, it} from 'vitest';

import {
  A2uiValidationError,
  type AgentToRendererMessage,
  defineMacro,
  type MacroParameter,
  MacroExpander,
  param,
} from '../../../src/index.js';

/** The argument `render` receives for `value`, passed to a parameter of the given kind. */
function coerce(parameter: MacroParameter, value: unknown): unknown {
  let received: unknown;
  const Probe = defineMacro({
    name: 'Probe',
    parameters: {value: parameter},
    render: ({value: coerced}) => {
      received = coerced;
      return {component: 'Text'};
    },
  });
  const messages = [
    {
      version: 'v1.0',
      updateComponents: {surfaceId: 's', components: [{component: 'Probe', id: 'p', value}]},
    },
  ] as unknown as AgentToRendererMessage[];
  new MacroExpander([Probe], {onError: 'raise'}).transformToTransport(messages);
  return received;
}

describe('argument coercion', () => {
  it.each([
    ['an event name', 'save', {event: {name: 'save'}}],
    [
      'an event name with the event fields beside it',
      {event: 'save', userMessage: 'Saved', context: {id: {'@path': '/id'}}},
      {event: {name: 'save', userMessage: 'Saved', context: {id: {'@path': '/id'}}}},
    ],
    ['an event body', {name: 'save', context: {a: 1}}, {event: {name: 'save', context: {a: 1}}}],
    [
      'a function call',
      {'@call': 'openUrl', args: {url: 'u'}},
      {functionCall: {'@call': 'openUrl', args: {url: 'u'}}},
    ],
    ['a full event action', {event: {name: 'save'}}, {event: {name: 'save'}}],
    [
      'a full function call action',
      {functionCall: {'@call': 'openUrl'}},
      {functionCall: {'@call': 'openUrl'}},
    ],
  ])('turns %s into an action', (_case, value, expected) => {
    expect(coerce(param.action(), value)).toEqual(expected);
  });

  it.each([
    ['a number', 1],
    ['an object without a name', {context: {}}],
    ['an event and a function call', {event: {name: 'a'}, functionCall: {'@call': 'b'}}],
    ['an event name and a function call', {event: 'a', functionCall: {'@call': 'b'}}],
  ])('rejects %s as an action', (_case, value) => {
    expect(() => coerce(param.action(), value)).toThrow(A2uiValidationError);
  });

  it.each([
    [param.dynamicString(), 'text'],
    [param.dynamicString(), {'@path': '/name'}],
    [param.dynamicString(), {'@call': 'formatString', args: {value: 'x'}}],
    [param.dynamicNumber(), 3],
    [param.dynamicBoolean(), false],
    [param.dynamicStringList(), ['a', 'b']],
    [param.dynamicStringList(), {'@path': '/tags'}],
  ])('passes a %o argument %j as written', (parameter, value) => {
    expect(coerce(parameter, value)).toEqual(value);
  });

  it.each([
    [param.dynamicString(), {path: '/name'}],
    [param.dynamicString(), {'@path': '/name', extra: 1}],
    [param.dynamicString(), 3],
    [param.dynamicNumber(), '3'],
    [param.dynamicBoolean(), 'true'],
    [param.dynamicStringList(), [1]],
  ])('rejects %o argument %j', (parameter, value) => {
    expect(() => coerce(parameter, value)).toThrow(A2uiValidationError);
  });

  it('keeps objects that are no binding or call as literal dynamic values', () => {
    expect(coerce(param.dynamicValue(), {path: '/usr/bin'})).toEqual({path: '/usr/bin'});
    expect(coerce(param.dynamicValue(), {call: 'x', ext: '1'})).toEqual({call: 'x', ext: '1'});
  });

  it('accepts a static list or a template for a child list', () => {
    expect(coerce(param.childList(), ['a', 'b'])).toEqual(['a', 'b']);
    expect(coerce(param.childList(), {path: '/items', componentId: 'row'})).toEqual({
      path: '/items',
      componentId: 'row',
    });
    expect(() => coerce(param.childList(), {path: '/items', template: 'row'})).toThrow(
      A2uiValidationError,
    );
  });

  it('checks check rules and accessibility attributes', () => {
    const rule = {condition: {'@call': 'required', args: {value: {'@path': '/v'}}}, message: 'm'};
    expect(coerce(param.checkRuleList(), [rule])).toEqual([rule]);
    expect(() => coerce(param.checkRuleList(), [{condition: true}])).toThrow(A2uiValidationError);
    expect(coerce(param.accessibility(), {label: 'Save'})).toEqual({label: 'Save'});
    expect(() => coerce(param.accessibility(), {role: 'button'})).toThrow(A2uiValidationError);
  });
});
