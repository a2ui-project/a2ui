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
import {
  TestWrapper,
  TestRenderer,
  createSurfaceUpdate,
  createBeginRendering,
  getMockCallArg,
} from '../../utils';
import type * as Types from '@a2ui/web_core/types/types';

/**
 * Button tests following A2UI specification.
 * Required: child (component ID string), action (with name)
 * Optional: primary
 *
 * Note: The spec uses `action.name` for the action identifier.
 */

/**
 * Helper to create Button messages with a Text child per A2UI spec.
 * child is a string ID referencing another component.
 * action requires `name` field.
 */
function createButtonMessages(
  id: string,
  props: {
    actionName: string;
    actionContext?: Array<{
      key: string;
      value: {
        literalString?: string;
        literalNumber?: number;
        literalBoolean?: boolean;
        path?: string;
      };
    }>;
    childText?: string;
    primary?: boolean;
  },
  surfaceId = '@default',
): Types.ServerToClientMessage[] {
  const textId = `${id}-text`;

  return [
    createSurfaceUpdate(
      [
        // First define the child Text component
        {
          id: textId,
          component: {
            Text: {
              text: {literalString: props.childText ?? 'Click me'},
              usageHint: 'body',
            },
          },
        },
        // Then define the Button referencing the child by ID
        {
          id,
          component: {
            Button: {
              child: textId,
              action: {
                name: props.actionName,
                context: props.actionContext,
              },
              primary: props.primary,
            },
          },
        },
      ],
      surfaceId,
    ),
    createBeginRendering(id, surfaceId),
  ];
}

describe('Button Component', () => {
  describe('Basic Rendering', () => {
    it('should render a button element', () => {
      const messages = createButtonMessages('btn-1', {actionName: 'submit'});

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const button = container.querySelector('button');
      expect(button).toBeInTheDocument();
      expect(button?.tagName).toBe('BUTTON');
    });

    it('should render with wrapper div having correct class', () => {
      const messages = createButtonMessages('btn-1', {actionName: 'submit'});

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-button');
      expect(wrapper).toBeInTheDocument();
      expect(wrapper?.tagName).toBe('DIV');
    });

    it('should render child text content inside button', () => {
      const messages = createButtonMessages('btn-1', {
        actionName: 'submit',
        childText: 'Submit Form',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const button = container.querySelector('button');
      expect(button).toBeInTheDocument();
      // Verify text is inside the button, not elsewhere
      expect(button?.textContent).toContain('Submit Form');
    });

    it('should render different text for different child content', () => {
      const messages1 = createButtonMessages('btn-1', {
        actionName: 'submit',
        childText: 'Save',
      });
      const messages2 = createButtonMessages('btn-2', {
        actionName: 'cancel',
        childText: 'Cancel',
      });

      const {container: container1} = render(
        <TestWrapper>
          <TestRenderer messages={messages1} />
        </TestWrapper>,
      );
      const {container: container2} = render(
        <TestWrapper>
          <TestRenderer messages={messages2} />
        </TestWrapper>,
      );

      expect(container1.querySelector('button')?.textContent).toContain('Save');
      expect(container2.querySelector('button')?.textContent).toContain('Cancel');
      // Verify they're different
      expect(container1.querySelector('button')?.textContent).not.toBe(
        container2.querySelector('button')?.textContent,
      );
    });
  });

  describe('Action Handling', () => {
    it('should call onAction with correct action name when clicked', () => {
      const mockOnAction = vi.fn();
      const messages = createButtonMessages('btn-1', {actionName: 'submit-form'});

      render(
        <TestWrapper onAction={mockOnAction}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(mockOnAction).toHaveBeenCalledTimes(1);
      // Verify the action payload contains the correct action name
      const event = getMockCallArg<Types.A2UIClientEventMessage>(mockOnAction, 0);
      expect(event).toHaveProperty('userAction');
      expect(event.userAction).toHaveProperty('name', 'submit-form');
      // Verify it's the specific action we defined, not some default
      expect(event.userAction?.name).not.toBe('default');
      expect(event.userAction?.name).not.toBe('click');
    });

    it('should dispatch action with correct context parameters', () => {
      const mockOnAction = vi.fn();
      const messages = createButtonMessages('btn-1', {
        actionName: 'delete-item',
        actionContext: [
          {key: 'itemId', value: {literalString: '123'}},
          {key: 'confirmed', value: {literalBoolean: true}},
        ],
      });

      render(
        <TestWrapper onAction={mockOnAction}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByRole('button'));

      expect(mockOnAction).toHaveBeenCalledTimes(1);
      const event = getMockCallArg<Types.A2UIClientEventMessage>(mockOnAction, 0);
      expect(event.userAction).toBeDefined();
      expect(event.userAction).toHaveProperty('name', 'delete-item');
      // Context should be passed through
      expect(event.userAction).toHaveProperty('context');
      // Verify context is an object (not undefined or null)
      expect(typeof event.userAction?.context).toBe('object');
    });

    it('should not call onAction before click', () => {
      const mockOnAction = vi.fn();
      const messages = createButtonMessages('btn-1', {actionName: 'test'});

      render(
        <TestWrapper onAction={mockOnAction}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // No click - should not have been called
      expect(mockOnAction).not.toHaveBeenCalled();
    });

    it('should call onAction multiple times for multiple clicks', () => {
      const mockOnAction = vi.fn();
      const messages = createButtonMessages('btn-1', {actionName: 'increment'});

      render(
        <TestWrapper onAction={mockOnAction}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const button = screen.getByRole('button');
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      expect(mockOnAction).toHaveBeenCalledTimes(3);
    });
  });

  describe('Accessibility', () => {
    it('should be focusable', () => {
      const messages = createButtonMessages('btn-1', {actionName: 'action'});

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const button = screen.getByRole('button');
      button.focus();
      expect(document.activeElement).toBe(button);
    });

    it('should be clickable via role', () => {
      const mockOnAction = vi.fn();
      const messages = createButtonMessages('btn-1', {actionName: 'action'});

      render(
        <TestWrapper onAction={mockOnAction}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Using getByRole ensures the button has proper ARIA role
      const button = screen.getByRole('button');
      fireEvent.click(button);
      expect(mockOnAction).toHaveBeenCalled();
    });
  });
});
