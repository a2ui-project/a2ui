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
  type AgentToRendererMessage,
  type ComponentNode,
  defineMacro,
  type MacroDefinition,
  MacroExpander,
  param,
} from '../../../src/index.js';

const Panel = defineMacro({
  name: 'Panel',
  parameters: {title: param.string()},
  render: ({title}): ComponentNode => ({
    component: 'Card',
    '@accessibility': {description: 'Panel'},
    '@checks': [{condition: {'@path': '/ok'}}],
    '@metadata': {extensions: {source: 'Panel'}, other: 1},
    child: {component: 'Text', text: title},
  }),
});

function lowerRoot(macro: MacroDefinition, invocation: Record<string, unknown>) {
  const messages = [
    {
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's',
        components: [{component: macro.name, id: 'p', ...invocation}],
      },
    },
  ] as unknown as AgentToRendererMessage[];
  const [message] = new MacroExpander([macro], {onError: 'raise'}).transformToTransport(
    messages,
  ) as unknown as Array<{updateComponents: {components: Array<Record<string, unknown>>}}>;
  return message.updateComponents.components.find(component => component['id'] === 'p');
}

describe('macro invocation envelope', () => {
  it('merges the envelope fields onto the root and drops @catalogId', () => {
    expect(
      lowerRoot(Panel, {
        title: 'T',
        '@catalogId': 'https://example.com/macros.json',
        '@accessibility': {label: 'Main panel'},
        '@checks': [{condition: {'@path': '/valid'}, message: 'Invalid'}],
        '@metadata': {extensions: {trace: 't1'}},
      }),
    ).toEqual({
      component: 'Card',
      id: 'p',
      '@accessibility': {description: 'Panel', label: 'Main panel'},
      '@checks': [
        {condition: {'@path': '/ok'}},
        {condition: {'@path': '/valid'}, message: 'Invalid'},
      ],
      '@metadata': {extensions: {source: 'Panel', trace: 't1'}, other: 1},
      child: 'p__text_1',
    });
  });

  it('reads the bare envelope names of payloads written before the @ prefix', () => {
    expect(
      lowerRoot(Panel, {title: 'T', accessibility: {label: 'Legacy'}, catalogId: 'x'}),
    ).toEqual(expect.objectContaining({'@accessibility': {description: 'Panel', label: 'Legacy'}}));
  });

  it('passes a bare envelope name the macro declares as an argument', () => {
    const Labeled = defineMacro({
      name: 'Labeled',
      parameters: {accessibility: param.accessibility({required: false})},
      render: ({accessibility}): ComponentNode => ({
        component: 'Text',
        text: String(accessibility?.label ?? 'none'),
      }),
    });

    expect(lowerRoot(Labeled, {accessibility: {label: 'Arg'}})).toEqual({
      component: 'Text',
      id: 'p',
      text: 'Arg',
    });
    expect(lowerRoot(Labeled, {'@accessibility': {label: 'Envelope'}})).toEqual({
      component: 'Text',
      id: 'p',
      text: 'none',
      '@accessibility': {label: 'Envelope'},
    });
  });

  it('reads arguments nested under parameters', () => {
    expect(
      lowerRoot(Panel, {parameters: {title: 'Nested'}, '@accessibility': {label: 'L'}}),
    ).toEqual(
      expect.objectContaining({
        child: 'p__text_1',
        '@accessibility': {description: 'Panel', label: 'L'},
      }),
    );
  });
});
