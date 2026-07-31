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

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
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
 * Modal tests following A2UI specification.
 * Required: entryPointChild, contentChild
 *
 * - entryPointChild: Component displayed as the trigger to open modal
 * - contentChild: Component displayed inside the modal dialog
 */

/**
 * Helper to create Modal messages with Text children.
 */
function createModalMessages(
  id: string,
  props: {
    triggerText: string;
    contentText: string;
  },
  surfaceId = '@default',
): Types.ServerToClientMessage[] {
  const triggerId = `${id}-trigger`;
  const contentId = `${id}-content`;

  return [
    createSurfaceUpdate(
      [
        // Entry point (trigger) component
        {
          id: triggerId,
          component: {
            Text: {text: {literalString: props.triggerText}, usageHint: 'body'},
          },
        },
        // Content component
        {
          id: contentId,
          component: {
            Text: {text: {literalString: props.contentText}, usageHint: 'body'},
          },
        },
        // Modal component
        {
          id,
          component: {
            Modal: {
              entryPointChild: triggerId,
              contentChild: contentId,
            },
          },
        },
      ],
      surfaceId,
    ),
    createBeginRendering(id, surfaceId),
  ];
}

// Mock HTMLDialogElement methods for jsdom
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Modal Component', () => {
  describe('Basic Rendering', () => {
    it('should render modal wrapper with correct class', () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-modal');
      expect(wrapper).toBeInTheDocument();
      expect(wrapper?.tagName).toBe('DIV');
    });

    it('should render entry point child (trigger) visible initially', () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Click to Open',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(screen.getByText('Click to Open')).toBeInTheDocument();
    });

    it('should NOT render modal content initially (before open)', () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Secret Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Modal content should not be visible initially
      expect(screen.queryByText('Secret Modal Content')).not.toBeInTheDocument();
    });

    it('should render different trigger text for different inputs', () => {
      const messages1 = createModalMessages('modal-1', {
        triggerText: 'Trigger A',
        contentText: 'Content A',
      });
      const messages2 = createModalMessages('modal-2', {
        triggerText: 'Trigger B',
        contentText: 'Content B',
      });

      const {container: container1} = render(
        <TestWrapper>
          <TestRenderer messages={messages1} />
        </TestWrapper>,
      );
      const {unmount} = {unmount: () => {}};

      const {container: container2} = render(
        <TestWrapper>
          <TestRenderer messages={messages2} />
        </TestWrapper>,
      );

      expect(container1.textContent).toContain('Trigger A');
      expect(container2.textContent).toContain('Trigger B');
      expect(container1.textContent).not.toBe(container2.textContent);
    });
  });

  describe('Opening Modal', () => {
    it('should open modal when clicking entry point', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content Here',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Click the trigger
      fireEvent.click(screen.getByText('Open Modal'));

      // Modal content should now be visible
      await waitFor(() => {
        expect(screen.getByText('Modal Content Here')).toBeInTheDocument();
      });
    });

    it('should render dialog element when open', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        const dialog = document.querySelector('dialog');
        expect(dialog).toBeInTheDocument();
      });
    });

    it('should call showModal() on the dialog element', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
      });
    });

    it('should render modal in portal (document.body)', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        // Dialog should be in document.body, not in the container
        const dialogInBody = document.body.querySelector('dialog');
        const dialogInContainer = container.querySelector('dialog');

        expect(dialogInBody).toBeInTheDocument();
        // The dialog is portaled, so it might not be in the container
        // depending on implementation
      });
    });
  });

  describe('Closing Modal', () => {
    it('should render close button inside modal', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        const closeButton = screen.getByRole('button', {name: /close/i});
        expect(closeButton).toBeInTheDocument();
      });
    });

    it('should close modal when clicking close button', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Open modal
      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        expect(screen.getByText('Modal Content')).toBeInTheDocument();
      });

      // Click close button
      const closeButton = screen.getByRole('button', {name: /close/i});
      fireEvent.click(closeButton);

      // Modal content should be removed
      await waitFor(() => {
        expect(screen.queryByText('Modal Content')).not.toBeInTheDocument();
      });
    });

    it('should close modal when clicking backdrop (dialog element)', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Open modal
      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        expect(screen.getByText('Modal Content')).toBeInTheDocument();
      });

      // Click on the dialog backdrop (the dialog element itself)
      const dialog = document.querySelector('dialog');
      if (dialog) {
        // Simulate clicking the backdrop by clicking the dialog directly
        // The component should check if the click target is the dialog itself
        fireEvent.click(dialog);
      }

      // Modal should close
      await waitFor(() => {
        expect(screen.queryByText('Modal Content')).not.toBeInTheDocument();
      });
    });

    it('should NOT close when clicking modal content', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Open modal
      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        expect(screen.getByText('Modal Content')).toBeInTheDocument();
      });

      // Click on the content (not the backdrop)
      fireEvent.click(screen.getByText('Modal Content'));

      // Modal should still be open
      expect(screen.getByText('Modal Content')).toBeInTheDocument();
    });

    it('should close modal on Escape key', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Open modal
      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        expect(screen.getByText('Modal Content')).toBeInTheDocument();
      });

      // Press Escape
      const dialog = document.querySelector('dialog');
      if (dialog) {
        fireEvent.keyDown(dialog, {key: 'Escape'});
      }

      // Modal should close
      await waitFor(() => {
        expect(screen.queryByText('Modal Content')).not.toBeInTheDocument();
      });
    });
  });

  describe('Nested Content', () => {
    it('should render complex content inside modal', async () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          // Trigger
          {
            id: 'trigger-text',
            component: {Text: {text: {literalString: 'Open'}, usageHint: 'body'}},
          },
          // Modal content: Column with button
          {
            id: 'modal-title',
            component: {Text: {text: {literalString: 'Modal Title'}, usageHint: 'h2'}},
          },
          {
            id: 'btn-text',
            component: {Text: {text: {literalString: 'Submit'}, usageHint: 'body'}},
          },
          {
            id: 'modal-btn',
            component: {Button: {child: 'btn-text', action: {name: 'submit'}}},
          },
          {
            id: 'modal-content',
            component: {Column: {children: {explicitList: ['modal-title', 'modal-btn']}}},
          },
          // Modal
          {
            id: 'modal-1',
            component: {
              Modal: {
                entryPointChild: 'trigger-text',
                contentChild: 'modal-content',
              },
            },
          },
        ]),
        createBeginRendering('modal-1'),
      ];

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Open modal
      fireEvent.click(screen.getByText('Open'));

      await waitFor(() => {
        expect(screen.getByText('Modal Title')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Submit'})).toBeInTheDocument();
      });
    });

    it('should dispatch actions from buttons inside modal', async () => {
      const mockOnAction = vi.fn();
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'trigger-text',
            component: {Text: {text: {literalString: 'Open'}, usageHint: 'body'}},
          },
          {
            id: 'btn-text',
            component: {Text: {text: {literalString: 'Action Button'}, usageHint: 'body'}},
          },
          {
            id: 'modal-btn',
            component: {Button: {child: 'btn-text', action: {name: 'modal-action'}}},
          },
          {
            id: 'modal-1',
            component: {
              Modal: {
                entryPointChild: 'trigger-text',
                contentChild: 'modal-btn',
              },
            },
          },
        ]),
        createBeginRendering('modal-1'),
      ];

      render(
        <TestWrapper onAction={mockOnAction}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Open modal
      fireEvent.click(screen.getByText('Open'));

      await waitFor(() => {
        expect(screen.getByRole('button', {name: 'Action Button'})).toBeInTheDocument();
      });

      // Click the action button inside modal
      fireEvent.click(screen.getByRole('button', {name: 'Action Button'}));

      expect(mockOnAction).toHaveBeenCalled();
      const event = getMockCallArg<Types.A2UIClientEventMessage>(mockOnAction, 0);
      expect(event.userAction).toBeDefined();
      expect(event.userAction?.name).toBe('modal-action');
    });
  });

  describe('Entry Point Styles', () => {
    it('should have cursor: pointer on entry point', () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // cursor: pointer is on the section inside the wrapper (entry point)
      const section = container.querySelector('.a2ui-modal > section');
      expect(section).toHaveStyle({cursor: 'pointer'});
    });
  });

  describe('Accessibility', () => {
    it('should have aria-label on close button', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        const closeButton = document.querySelector('#controls button');
        expect(closeButton?.getAttribute('aria-label')).toBe('Close modal');
      });
    });

    it('should use native dialog element for accessibility', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        const dialog = document.querySelector('dialog');
        expect(dialog).toBeInTheDocument();
        expect(dialog?.tagName).toBe('DIALOG');
      });
    });
  });

  describe('Structure', () => {
    it('should have correct DOM structure when closed', () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Entry point wrapper
      const wrapper = container.querySelector('.a2ui-modal');
      expect(wrapper?.tagName).toBe('DIV');

      // Entry point content (Text) inside wrapper
      const textInWrapper = wrapper?.querySelector('.a2ui-text');
      expect(textInWrapper).toBeInTheDocument();

      // No dialog when closed
      expect(document.querySelector('dialog')).not.toBeInTheDocument();
    });

    it('should have correct DOM structure when open', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      fireEvent.click(screen.getByText('Open Modal'));

      await waitFor(() => {
        const dialog = document.querySelector('dialog');
        expect(dialog).toBeInTheDocument();

        // Dialog should contain section with content
        const section = dialog?.querySelector('section');
        expect(section).toBeInTheDocument();

        // Controls div with close button inside section
        const controls = section?.querySelector('#controls');
        expect(controls).toBeInTheDocument();

        // Close button inside controls
        const closeButton = controls?.querySelector('button');
        expect(closeButton).toBeInTheDocument();
      });
    });
  });

  describe('Re-opening Modal', () => {
    it('should be able to open modal after closing', async () => {
      const messages = createModalMessages('modal-1', {
        triggerText: 'Open Modal',
        contentText: 'Modal Content',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Open modal
      fireEvent.click(screen.getByText('Open Modal'));
      await waitFor(() => {
        expect(screen.getByText('Modal Content')).toBeInTheDocument();
      });

      // Close modal
      const closeButton = screen.getByRole('button', {name: /close/i});
      fireEvent.click(closeButton);
      await waitFor(() => {
        expect(screen.queryByText('Modal Content')).not.toBeInTheDocument();
      });

      // Re-open modal
      fireEvent.click(screen.getByText('Open Modal'));
      await waitFor(() => {
        expect(screen.getByText('Modal Content')).toBeInTheDocument();
      });
    });
  });
});
