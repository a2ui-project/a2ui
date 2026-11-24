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

import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  A2uiRecursionError,
  A2uiValidationError,
  type AgentToRendererMessage,
  type ComponentNode,
  defineMacro,
  type MacroDefinition,
  MacroExpander,
  param,
} from '../../../src/index.js';

const Label = defineMacro({
  name: 'Label',
  parameters: {
    text: param.string(),
    tone: param.string({enum: ['info', 'warning'], default: 'info'}),
    count: param.integer({required: false}),
    targets: param.componentList({required: false}),
  },
  render: ({text, tone, targets}) => ({
    component: 'Column',
    children: [{component: 'Text', text, variant: tone}, ...(targets ?? [])],
  }),
});

function update(components: unknown[]): AgentToRendererMessage[] {
  return [
    {version: 'v1.0', updateComponents: {surfaceId: 's', components}},
  ] as unknown as AgentToRendererMessage[];
}

function lowerComponents(
  macros: readonly MacroDefinition[],
  components: unknown[],
): Array<Record<string, unknown>> {
  const [message] = new MacroExpander(macros, {onError: 'raise'}).transformToTransport(
    update(components),
  ) as unknown as Array<{updateComponents: {components: Array<Record<string, unknown>>}}>;
  return message.updateComponents.components;
}

describe('MacroExpander.transformToTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces an invocation with its components, root last with the invocation ID', () => {
    expect(lowerComponents([Label], [{component: 'Label', id: 'l', text: 'Hi'}])).toEqual([
      {component: 'Text', id: 'l__text_1', text: 'Hi', variant: 'info'},
      {component: 'Column', id: 'l', children: ['l__text_1']},
    ]);
  });

  it('lowers invocations in createSurface components and keeps other messages', () => {
    const messages = [
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's',
          catalogId: 'c',
          components: [{component: 'Label', id: 'a', text: 'A'}],
        },
      },
      {version: 'v1.0', deleteSurface: {surfaceId: 's'}},
    ] as unknown as AgentToRendererMessage[];

    const lowered = new MacroExpander([Label]).transformToTransport(messages);

    expect(lowered).toEqual([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's',
          catalogId: 'c',
          components: [
            {component: 'Text', id: 'a__text_1', text: 'A', variant: 'info'},
            {component: 'Column', id: 'a', children: ['a__text_1']},
          ],
        },
      },
      {version: 'v1.0', deleteSurface: {surfaceId: 's'}},
    ]);
  });

  it('leaves the messages it was given unchanged', () => {
    const messages = update([
      {component: 'Text', id: 't', text: 'plain'},
      {component: 'Label', id: 'l', text: 'Hi', targets: ['t']},
    ]);
    const before = structuredClone(messages);

    new MacroExpander([Label]).transformToTransport(messages);

    expect(messages).toEqual(before);
  });

  it('lowers macros that a rendered tree uses, namespaced under their own ID', () => {
    const Outer = defineMacro({
      name: 'Outer',
      render: (): ComponentNode => ({component: 'Card', child: {component: 'Label', text: 'In'}}),
    });

    expect(lowerComponents([Label, Outer], [{component: 'Outer', id: 'o'}])).toEqual([
      {component: 'Text', id: 'o__label_1__text_1', text: 'In', variant: 'info'},
      {component: 'Column', id: 'o__label_1', children: ['o__label_1__text_1']},
      {component: 'Card', id: 'o', child: 'o__label_1'},
    ]);
  });

  it('throws A2uiRecursionError for a render that calls itself', () => {
    const Loop: MacroDefinition = defineMacro({
      name: 'Loop',
      render: () => ({component: 'Card', child: Loop.render({})}),
    });

    expect(() => lowerComponents([Loop], [{component: 'Loop', id: 'x'}])).toThrow(
      A2uiRecursionError,
    );
  });

  it('throws A2uiRecursionError for a macro whose tree uses it again', () => {
    const Loop = defineMacro({
      name: 'Loop',
      render: (): ComponentNode => ({component: 'Card', child: {component: 'Loop'}}),
    });

    expect(() => lowerComponents([Loop], [{component: 'Loop', id: 'x'}])).toThrow(
      A2uiRecursionError,
    );
  });

  it('throws when render returns something other than a component node', () => {
    const Broken = defineMacro({
      name: 'Broken',
      render: () => 'Text' as unknown as ComponentNode,
    });

    expect(() => lowerComponents([Broken], [{component: 'Broken', id: 'x'}])).toThrow(
      A2uiValidationError,
    );
  });

  it('passes the default for an argument set to null', () => {
    expect(
      lowerComponents([Label], [{component: 'Label', id: 'l', text: 'Hi', tone: null}])[0],
    ).toEqual({component: 'Text', id: 'l__text_1', text: 'Hi', variant: 'info'});
  });

  it.each([
    ['an argument without a parameter', {text: 'Hi', weight: 2}],
    ['a missing required argument', {}],
    ['a value outside the enum', {text: 'Hi', tone: 'loud'}],
    ['a binding for a string', {text: {'@path': '/t'}}],
    ['a boolean for an integer', {text: 'Hi', count: true}],
    ['a fraction for an integer', {text: 'Hi', count: 1.5}],
    ['a template map for a component list', {text: 'Hi', targets: {path: '/p', componentId: 't'}}],
  ])('rejects %s', (_case, args) => {
    expect(() => lowerComponents([Label], [{component: 'Label', id: 'l', ...args}])).toThrow(
      A2uiValidationError,
    );
  });

  it('rejects messages of another protocol version, with or without macros', () => {
    const v09 = [
      {version: 'v0.9', updateComponents: {surfaceId: 's', components: []}},
    ] as unknown as AgentToRendererMessage[];

    expect(() => new MacroExpander([Label]).transformToTransport(v09)).toThrow(A2uiValidationError);
    expect(() => new MacroExpander([]).transformToTransport(v09)).toThrow(A2uiValidationError);
  });

  it('throws for a macro that renders a Surface whatever onError says', () => {
    const Bad = defineMacro({name: 'Bad', render: () => ({component: 'Ｓurface'})});

    expect(() =>
      new MacroExpander([Bad]).transformToTransport(update([{component: 'Bad', id: 'b'}])),
    ).toThrow(A2uiValidationError);
  });

  it('keeps a failed invocation unexpanded and logs it under onError passthrough', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const [message] = new MacroExpander([Label]).transformToTransport(
      update([
        {component: 'Label', id: 'bad', text: 'Hi', weight: 2},
        {component: 'Label', id: 'ok', text: 'Ok'},
      ]),
    ) as unknown as Array<{updateComponents: {components: Array<Record<string, unknown>>}}>;

    expect(message.updateComponents.components.map(component => component['id'])).toEqual([
      'bad',
      'ok__text_1',
      'ok',
    ]);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('wraps an error from render in A2uiValidationError under onError raise', () => {
    const Throws = defineMacro({
      name: 'Throws',
      render: (): ComponentNode => {
        throw new Error('boom');
      },
    });

    expect(() => lowerComponents([Throws], [{component: 'Throws', id: 't'}])).toThrow(
      /Failed to expand macro 'Throws' \(id="t"\): Error: boom/,
    );
  });
});
