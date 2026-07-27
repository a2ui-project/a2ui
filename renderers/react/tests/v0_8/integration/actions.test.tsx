/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import React from 'react';
import type * as Types from '@a2ui/web_core/types/types';
import {
  TestWrapper,
  TestRenderer,
  createSurfaceUpdate,
  createBeginRendering,
  getMockCallArg,
} from '../utils';

/**
 * Action Dispatch Integration Tests
 *
 * Tests for dispatching actions from components to the onAction callback.
 */

describe('Action Dispatch', () => {
  it('should dispatch action with name', () => {
    const mockOnAction = vi.fn();
    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {
          id: 'btn-text',
          component: {Text: {text: {literalString: 'Submit'}, usageHint: 'body'}},
        },
        {id: 'btn-1', component: {Button: {child: 'btn-text', action: {name: 'submit'}}}},
      ]),
      createBeginRendering('btn-1'),
    ];

    render(
      <TestWrapper onAction={mockOnAction}>
        <TestRenderer messages={messages} />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(mockOnAction).toHaveBeenCalledTimes(1);
    const event = getMockCallArg<Types.A2UIClientEventMessage>(mockOnAction, 0);
    expect(event.userAction).toBeDefined();
    expect(event.userAction?.name).toBe('submit');
  });

  it('should dispatch action with context parameters', () => {
    const mockOnAction = vi.fn();
    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {
          id: 'btn-text',
          component: {Text: {text: {literalString: 'Delete'}, usageHint: 'body'}},
        },
        {
          id: 'btn-1',
          component: {
            Button: {
              child: 'btn-text',
              action: {
                name: 'delete',
                context: [
                  {key: 'itemId', value: {literalString: 'item-123'}},
                  {key: 'confirmed', value: {literalBoolean: true}},
                ],
              },
            },
          },
        },
      ]),
      createBeginRendering('btn-1'),
    ];

    render(
      <TestWrapper onAction={mockOnAction}>
        <TestRenderer messages={messages} />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(mockOnAction).toHaveBeenCalledTimes(1);
    const event = getMockCallArg<Types.A2UIClientEventMessage>(mockOnAction, 0);
    expect(event.userAction).toBeDefined();
    expect(event.userAction?.name).toBe('delete');
    expect(event.userAction?.context).toBeDefined();
  });

  it('should not call onAction if not provided', () => {
    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {
          id: 'btn-text',
          component: {Text: {text: {literalString: 'Click'}, usageHint: 'body'}},
        },
        {id: 'btn-1', component: {Button: {child: 'btn-text', action: {name: 'test'}}}},
      ]),
      createBeginRendering('btn-1'),
    ];

    render(
      <TestWrapper>
        <TestRenderer messages={messages} />
      </TestWrapper>,
    );

    expect(() => {
      fireEvent.click(screen.getByRole('button'));
    }).not.toThrow();
  });

  it('should dispatch actions from different components', () => {
    const mockOnAction = vi.fn();
    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {
          id: 'btn1-text',
          component: {Text: {text: {literalString: 'Action 1'}, usageHint: 'body'}},
        },
        {id: 'btn1', component: {Button: {child: 'btn1-text', action: {name: 'action-1'}}}},
        {
          id: 'btn2-text',
          component: {Text: {text: {literalString: 'Action 2'}, usageHint: 'body'}},
        },
        {id: 'btn2', component: {Button: {child: 'btn2-text', action: {name: 'action-2'}}}},
        {id: 'col', component: {Column: {children: {explicitList: ['btn1', 'btn2']}}}},
      ]),
      createBeginRendering('col'),
    ];

    render(
      <TestWrapper onAction={mockOnAction}>
        <TestRenderer messages={messages} />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole('button', {name: 'Action 1'}));
    expect(mockOnAction).toHaveBeenCalledTimes(1);
    const event1 = getMockCallArg<Types.A2UIClientEventMessage>(mockOnAction, 0);
    expect(event1.userAction).toBeDefined();
    expect(event1.userAction?.name).toBe('action-1');

    fireEvent.click(screen.getByRole('button', {name: 'Action 2'}));
    expect(mockOnAction).toHaveBeenCalledTimes(2);
    const event2 = getMockCallArg<Types.A2UIClientEventMessage>(mockOnAction, 1);
    expect(event2.userAction).toBeDefined();
    expect(event2.userAction?.name).toBe('action-2');
  });

  it('should resolve path bindings in action context from data model', () => {
    const mockOnAction = vi.fn();
    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {
          id: 'tf-1',
          component: {
            TextField: {
              text: {path: 'form.username'},
              label: {literalString: 'Username'},
            },
          },
        },
        {
          id: 'btn-text',
          component: {Text: {text: {literalString: 'Submit'}, usageHint: 'body'}},
        },
        {
          id: 'btn-1',
          component: {
            Button: {
              child: 'btn-text',
              action: {
                name: 'submit-form',
                context: [{key: 'username', value: {path: 'form.username'}}],
              },
            },
          },
        },
        {id: 'col', component: {Column: {children: {explicitList: ['tf-1', 'btn-1']}}}},
      ]),
      createBeginRendering('col'),
    ];

    const {container} = render(
      <TestWrapper onAction={mockOnAction}>
        <TestRenderer messages={messages} />
      </TestWrapper>,
    );

    // User types in the TextField, updating the data model via path binding
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, {target: {value: 'alice123'}});

    // User clicks the Submit button
    fireEvent.click(screen.getByRole('button', {name: 'Submit'}));

    // Verify the action context contains the resolved value from the data model
    expect(mockOnAction).toHaveBeenCalledTimes(1);
    const event = getMockCallArg<Types.A2UIClientEventMessage>(mockOnAction, 0);
    expect(event.userAction).toBeDefined();
    expect(event.userAction?.name).toBe('submit-form');
    expect(event.userAction?.context).toEqual({username: 'alice123'});
  });

  it('should resolve mixed literal and path context parameters', () => {
    const mockOnAction = vi.fn();
    const messages: Types.ServerToClientMessage[] = [
      createSurfaceUpdate([
        {
          id: 'tf-name',
          component: {
            TextField: {
              text: {path: 'form.name'},
              label: {literalString: 'Name'},
            },
          },
        },
        {
          id: 'cb-agree',
          component: {
            CheckBox: {
              value: {path: 'form.agreed'},
              label: {literalString: 'I agree'},
            },
          },
        },
        {
          id: 'btn-text',
          component: {Text: {text: {literalString: 'Submit'}, usageHint: 'body'}},
        },
        {
          id: 'btn-1',
          component: {
            Button: {
              child: 'btn-text',
              action: {
                name: 'submit-form',
                context: [
                  {key: 'formId', value: {literalString: 'registration-form'}},
                  {key: 'version', value: {literalNumber: 2}},
                  {key: 'name', value: {path: 'form.name'}},
                  {key: 'agreed', value: {path: 'form.agreed'}},
                ],
              },
            },
          },
        },
        {
          id: 'col',
          component: {Column: {children: {explicitList: ['tf-name', 'cb-agree', 'btn-1']}}},
        },
      ]),
      createBeginRendering('col'),
    ];

    const {container} = render(
      <TestWrapper onAction={mockOnAction}>
        <TestRenderer messages={messages} />
      </TestWrapper>,
    );

    // User fills the form
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, {target: {value: 'John Doe'}});

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // User clicks Submit
    fireEvent.click(screen.getByRole('button', {name: 'Submit'}));

    // Verify mixed context: literals + resolved paths
    expect(mockOnAction).toHaveBeenCalledTimes(1);
    const event = getMockCallArg<Types.A2UIClientEventMessage>(mockOnAction, 0);
    expect(event.userAction?.name).toBe('submit-form');
    expect(event.userAction?.context).toEqual({
      formId: 'registration-form',
      version: 2,
      name: 'John Doe',
      agreed: true,
    });
  });
});
