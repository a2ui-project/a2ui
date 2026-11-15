/*
 * Copyright 2026 Google LLC
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

import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import React from 'react';
import {A2uiConfigurationError, type JsonSchemaValidator} from '@a2ui/web_core';
import type * as Types from '@a2ui/web_core/types/types';
import {A2UIProvider, A2UIViewer, useA2UIActions} from '../../../src/v0_8';
import {validator} from '../../validator';

function ProcessOnMount({messages}: {messages: Types.ServerToClientMessage[]}) {
  const {processMessages} = useA2UIActions();
  processMessages(messages);
  return null;
}

describe('v0.8 JSON Schema validator', () => {
  it('A2UIProvider requires a validator', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        render(
          <A2UIProvider validator={undefined as unknown as JsonSchemaValidator}>
            <div />
          </A2UIProvider>,
        ),
      ).toThrow(A2uiConfigurationError);
    } finally {
      errors.mockRestore();
    }
  });

  it('A2UIProvider checks messages with the given validator', () => {
    const compile = vi.fn(validator.compile.bind(validator));
    const spy: JsonSchemaValidator = {
      ...validator,
      compile: compile as JsonSchemaValidator['compile'],
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        render(
          <A2UIProvider validator={spy}>
            <ProcessOnMount
              messages={[
                {beginRendering: {root: 'root'}} as unknown as Types.ServerToClientMessage,
              ]}
            />
          </A2UIProvider>,
        ),
      ).toThrow(/surfaceId/);
    } finally {
      errors.mockRestore();
    }
    expect(compile).toHaveBeenCalled();
  });

  it('A2UIViewer renders with the given validator', async () => {
    render(
      <A2UIViewer
        validator={validator}
        root="root"
        components={[{id: 'root', component: {Text: {text: {literalString: 'Hello'}}}}]}
      />,
    );
    expect(await screen.findByText('Hello')).toBeInTheDocument();
  });
});
