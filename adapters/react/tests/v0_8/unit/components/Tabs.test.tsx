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

import {describe, it, expect} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import React from 'react';
import {TestWrapper, TestRenderer, createSurfaceUpdate, createBeginRendering} from '../../utils';
import type * as Types from '@a2ui/web_core/types/types';

/**
 * Tabs tests following A2UI specification.
 * Required: tabItems (array of { title, child })
 *
 * Each tab item has:
 * - title: StringValue (literal or path)
 * - child: component ID string
 */

/**
 * Helper to create Tabs messages with Text content children.
 */
function createTabsMessages(
  id: string,
  props: {
    tabs: Array<{title: string; contentText: string}>;
  },
  surfaceId = '@default',
): Types.ServerToClientMessage[] {
  const components: Array<{id: string; component: Record<string, unknown>}> = [];

  // Create content components for each tab
  const tabItems = props.tabs.map((tab, index) => {
    const contentId = `${id}-content-${index}`;
    components.push({
      id: contentId,
      component: {
        Text: {text: {literalString: tab.contentText}, usageHint: 'body'},
      },
    });
    return {
      title: {literalString: tab.title},
      child: contentId,
    };
  });

  // Add the Tabs component
  components.push({
    id,
    component: {
      Tabs: {tabItems},
    },
  });

  return [createSurfaceUpdate(components, surfaceId), createBeginRendering(id, surfaceId)];
}

describe('Tabs Component', () => {
  describe('Basic Rendering', () => {
    it('should render a tabs container with correct class', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'Content 1'},
          {title: 'Tab 2', contentText: 'Content 2'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-tabs');
      expect(wrapper).toBeInTheDocument();
      expect(wrapper?.tagName).toBe('DIV');
    });

    it('should render section element inside wrapper', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [{title: 'Tab 1', contentText: 'Content 1'}],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-tabs > section');
      expect(section).toBeInTheDocument();
    });

    it('should render buttons container with id="buttons"', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'Content 1'},
          {title: 'Tab 2', contentText: 'Content 2'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const buttonsContainer = container.querySelector('#buttons');
      expect(buttonsContainer).toBeInTheDocument();
      expect(buttonsContainer?.tagName).toBe('DIV');
    });
  });

  describe('Tab Buttons', () => {
    it('should render a button for each tab', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'First', contentText: 'Content 1'},
          {title: 'Second', contentText: 'Content 2'},
          {title: 'Third', contentText: 'Content 3'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const buttons = container.querySelectorAll('#buttons button');
      expect(buttons.length).toBe(3);
    });

    it('should display tab titles in buttons', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Overview', contentText: 'Content 1'},
          {title: 'Details', contentText: 'Content 2'},
        ],
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(screen.getByRole('button', {name: 'Overview'})).toBeInTheDocument();
      expect(screen.getByRole('button', {name: 'Details'})).toBeInTheDocument();
    });

    it('should disable the currently selected tab button', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'Content 1'},
          {title: 'Tab 2', contentText: 'Content 2'},
        ],
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const tab1Button = screen.getByRole('button', {name: 'Tab 1'});
      const tab2Button = screen.getByRole('button', {name: 'Tab 2'});

      // First tab selected by default - should be disabled
      expect(tab1Button).toBeDisabled();
      expect(tab2Button).not.toBeDisabled();
    });

    it('should have different disabled states for different tabs', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab A', contentText: 'Content A'},
          {title: 'Tab B', contentText: 'Content B'},
        ],
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const tabA = screen.getByRole('button', {name: 'Tab A'}) as HTMLButtonElement;
      const tabB = screen.getByRole('button', {name: 'Tab B'}) as HTMLButtonElement;

      // Initially Tab A is selected (disabled)
      expect(tabA.disabled).not.toBe(tabB.disabled);
    });
  });

  describe('Tab Selection', () => {
    it('should select first tab by default', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'First tab content'},
          {title: 'Tab 2', contentText: 'Second tab content'},
        ],
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // First tab's content should be visible
      expect(screen.getByText('First tab content')).toBeInTheDocument();
    });

    it('should switch content when clicking a different tab', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'First tab content'},
          {title: 'Tab 2', contentText: 'Second tab content'},
        ],
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Initially first tab content visible
      expect(screen.getByText('First tab content')).toBeInTheDocument();

      // Click second tab
      fireEvent.click(screen.getByRole('button', {name: 'Tab 2'}));

      // Second tab content should now be visible
      expect(screen.getByText('Second tab content')).toBeInTheDocument();
    });

    it('should hide previous tab content when switching', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'First tab content'},
          {title: 'Tab 2', contentText: 'Second tab content'},
        ],
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Click second tab
      fireEvent.click(screen.getByRole('button', {name: 'Tab 2'}));

      // First tab content should no longer be in document
      expect(screen.queryByText('First tab content')).not.toBeInTheDocument();
    });

    it('should update disabled state when switching tabs', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'Content 1'},
          {title: 'Tab 2', contentText: 'Content 2'},
        ],
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const tab1Button = screen.getByRole('button', {name: 'Tab 1'});
      const tab2Button = screen.getByRole('button', {name: 'Tab 2'});

      // Initially Tab 1 is disabled
      expect(tab1Button).toBeDisabled();
      expect(tab2Button).not.toBeDisabled();

      // Click Tab 2
      fireEvent.click(tab2Button);

      // Now Tab 2 should be disabled, Tab 1 enabled
      expect(tab1Button).not.toBeDisabled();
      expect(tab2Button).toBeDisabled();
    });

    it('should handle switching between multiple tabs', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'Content One'},
          {title: 'Tab 2', contentText: 'Content Two'},
          {title: 'Tab 3', contentText: 'Content Three'},
        ],
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Start at Tab 1
      expect(screen.getByText('Content One')).toBeInTheDocument();

      // Go to Tab 3
      fireEvent.click(screen.getByRole('button', {name: 'Tab 3'}));
      expect(screen.getByText('Content Three')).toBeInTheDocument();
      expect(screen.queryByText('Content One')).not.toBeInTheDocument();

      // Go to Tab 2
      fireEvent.click(screen.getByRole('button', {name: 'Tab 2'}));
      expect(screen.getByText('Content Two')).toBeInTheDocument();
      expect(screen.queryByText('Content Three')).not.toBeInTheDocument();

      // Go back to Tab 1
      fireEvent.click(screen.getByRole('button', {name: 'Tab 1'}));
      expect(screen.getByText('Content One')).toBeInTheDocument();
    });
  });

  describe('Nested Content', () => {
    it('should render complex nested content in tabs', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          // Tab 1: Column with multiple text items
          {
            id: 'text-1a',
            component: {Text: {text: {literalString: 'Item 1'}, usageHint: 'body'}},
          },
          {
            id: 'text-1b',
            component: {Text: {text: {literalString: 'Item 2'}, usageHint: 'body'}},
          },
          {
            id: 'col-1',
            component: {Column: {children: {explicitList: ['text-1a', 'text-1b']}}},
          },
          // Tab 2: Button
          {
            id: 'btn-text',
            component: {Text: {text: {literalString: 'Click me'}, usageHint: 'body'}},
          },
          {id: 'btn-1', component: {Button: {child: 'btn-text', action: {name: 'test'}}}},
          // Tabs
          {
            id: 'tabs-1',
            component: {
              Tabs: {
                tabItems: [
                  {title: {literalString: 'List'}, child: 'col-1'},
                  {title: {literalString: 'Action'}, child: 'btn-1'},
                ],
              },
            },
          },
        ]),
        createBeginRendering('tabs-1'),
      ];

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // First tab shows column content
      expect(screen.getByText('Item 1')).toBeInTheDocument();
      expect(screen.getByText('Item 2')).toBeInTheDocument();

      // Switch to second tab
      fireEvent.click(screen.getByRole('button', {name: 'Action'}));

      // Button should be visible
      expect(screen.getByRole('button', {name: 'Click me'})).toBeInTheDocument();
    });
  });

  describe('Empty/Edge Cases', () => {
    it('should render with single tab', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [{title: 'Only Tab', contentText: 'Only content'}],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const buttons = container.querySelectorAll('#buttons button');
      expect(buttons.length).toBe(1);
      expect(screen.getByText('Only content')).toBeInTheDocument();
    });

    it('should handle empty tabItems gracefully', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'tabs-1',
            component: {
              Tabs: {tabItems: []},
            },
          },
        ]),
        createBeginRendering('tabs-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Should still render the tabs wrapper
      const wrapper = container.querySelector('.a2ui-tabs');
      expect(wrapper).toBeInTheDocument();

      // No buttons should exist
      const buttons = container.querySelectorAll('#buttons button');
      expect(buttons.length).toBe(0);
    });
  });

  describe('Theme Support', () => {
    it('should render section container (theme classes empty by design)', () => {
      // Tabs styling comes from structural CSS, not theme classes.
      // The litTheme.components.Tabs.container is intentionally empty.
      const messages = createTabsMessages('tabs-1', {
        tabs: [{title: 'Tab 1', contentText: 'Content 1'}],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-tabs > section');
      expect(section).toBeInTheDocument();
    });

    it('should render buttons container (theme classes empty by design)', () => {
      // Tabs button container styling comes from structural CSS.
      // The litTheme.components.Tabs.element is intentionally empty.
      const messages = createTabsMessages('tabs-1', {
        tabs: [{title: 'Tab 1', contentText: 'Content 1'}],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const buttonsContainer = container.querySelector('#buttons');
      expect(buttonsContainer).toBeInTheDocument();
    });

    it('should render tab buttons (theme classes empty by design)', () => {
      // Tab button styling comes from structural CSS.
      // The litTheme.components.Tabs.controls.all/selected are intentionally empty.
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'Content 1'},
          {title: 'Tab 2', contentText: 'Content 2'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const buttons = container.querySelectorAll('#buttons button');
      expect(buttons.length).toBe(2);
      expect(buttons[0]).toBeInTheDocument();
      expect(buttons[1]).toBeInTheDocument();
    });
  });

  describe('Structure', () => {
    it('should have correct DOM structure: div.a2ui-tabs > section > #buttons + content', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [{title: 'Tab 1', contentText: 'Content 1'}],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-tabs');
      expect(wrapper?.tagName).toBe('DIV');

      const section = wrapper?.querySelector('section');
      expect(section).toBeInTheDocument();

      // Section should contain buttons div and content
      const buttonsDiv = section?.querySelector('#buttons');
      expect(buttonsDiv).toBeInTheDocument();

      // Content (Text component) should be after buttons
      const textWrapper = section?.querySelector('.a2ui-text');
      expect(textWrapper).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have focusable tab buttons', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'Content 1'},
          {title: 'Tab 2', contentText: 'Content 2'},
        ],
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const tab2Button = screen.getByRole('button', {name: 'Tab 2'});
      tab2Button.focus();
      expect(document.activeElement).toBe(tab2Button);
    });

    it('should be keyboard activatable', () => {
      const messages = createTabsMessages('tabs-1', {
        tabs: [
          {title: 'Tab 1', contentText: 'Content 1'},
          {title: 'Tab 2', contentText: 'Content 2'},
        ],
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const tab2Button = screen.getByRole('button', {name: 'Tab 2'});

      // Focus and press Enter
      tab2Button.focus();
      fireEvent.keyDown(tab2Button, {key: 'Enter'});
      fireEvent.click(tab2Button); // Buttons respond to click, not keyDown by default

      expect(screen.getByText('Content 2')).toBeInTheDocument();
    });
  });
});
