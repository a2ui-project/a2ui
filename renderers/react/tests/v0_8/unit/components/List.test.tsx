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
import {render} from '@testing-library/react';
import React from 'react';
import {TestWrapper, TestRenderer, createSurfaceUpdate, createBeginRendering} from '../../utils';
import type * as Types from '@a2ui/web_core/types/types';

/**
 * List tests following A2UI specification.
 * Required: children
 * Optional: direction (vertical | horizontal), alignment
 */

/**
 * Helper to create List messages with Text children.
 */
function createListMessages(
  id: string,
  props: {
    childIds: string[];
    childTexts?: string[];
    direction?: 'vertical' | 'horizontal';
    alignment?: 'start' | 'center' | 'end' | 'stretch';
  },
  surfaceId = '@default',
): Types.ServerToClientMessage[] {
  const children = props.childIds.map((childId, index) => ({
    id: childId,
    component: {
      Text: {
        text: {literalString: props.childTexts?.[index] ?? `Item ${index + 1}`},
        usageHint: 'body',
      },
    },
  }));

  return [
    createSurfaceUpdate(
      [
        ...children,
        {
          id,
          component: {
            List: {
              children: {explicitList: props.childIds},
              direction: props.direction,
              alignment: props.alignment,
            },
          },
        },
      ],
      surfaceId,
    ),
    createBeginRendering(id, surfaceId),
  ];
}

describe('List Component', () => {
  describe('Basic Rendering', () => {
    it('should render a list container', () => {
      const messages = createListMessages('list-1', {
        childIds: ['item-1', 'item-2'],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const list = container.querySelector('.a2ui-list');
      expect(list).toBeInTheDocument();
    });

    it('should render section element inside list', () => {
      const messages = createListMessages('list-1', {
        childIds: ['item-1', 'item-2'],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('.a2ui-list section');
      expect(section).toBeInTheDocument();
    });

    it('should render all children', () => {
      const messages = createListMessages('list-1', {
        childIds: ['item-1', 'item-2', 'item-3'],
        childTexts: ['First', 'Second', 'Third'],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(container.textContent).toContain('First');
      expect(container.textContent).toContain('Second');
      expect(container.textContent).toContain('Third');
    });

    it('should render correct number of children', () => {
      const messages = createListMessages('list-1', {
        childIds: ['item-1', 'item-2', 'item-3', 'item-4'],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Each Text component is wrapped in a2ui-text div
      const textComponents = container.querySelectorAll('.a2ui-text');
      expect(textComponents.length).toBe(4);
    });

    it('should render different number of items for different inputs', () => {
      const messages2 = createListMessages('list-1', {
        childIds: ['item-1', 'item-2'],
      });
      const messages4 = createListMessages('list-2', {
        childIds: ['item-1', 'item-2', 'item-3', 'item-4'],
      });

      const {container: container2} = render(
        <TestWrapper>
          <TestRenderer messages={messages2} />
        </TestWrapper>,
      );
      const {container: container4} = render(
        <TestWrapper>
          <TestRenderer messages={messages4} />
        </TestWrapper>,
      );

      const items2 = container2.querySelectorAll('.a2ui-text');
      const items4 = container4.querySelectorAll('.a2ui-text');

      expect(items2.length).toBe(2);
      expect(items4.length).toBe(4);
      expect(items2.length).not.toBe(items4.length);
    });
  });

  describe('Direction', () => {
    it('should default to vertical direction', () => {
      const messages = createListMessages('list-1', {
        childIds: ['item-1'],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const list = container.querySelector('.a2ui-list');
      expect(list?.getAttribute('data-direction')).toBe('vertical');
    });

    it('should set horizontal direction when specified', () => {
      const messages = createListMessages('list-1', {
        childIds: ['item-1'],
        direction: 'horizontal',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const list = container.querySelector('.a2ui-list');
      expect(list?.getAttribute('data-direction')).toBe('horizontal');
      expect(list?.getAttribute('data-direction')).not.toBe('vertical');
    });

    it('should set vertical direction when specified', () => {
      const messages = createListMessages('list-1', {
        childIds: ['item-1'],
        direction: 'vertical',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const list = container.querySelector('.a2ui-list');
      expect(list?.getAttribute('data-direction')).toBe('vertical');
    });

    it('should render different directions for different inputs', () => {
      const messagesH = createListMessages('list-1', {
        childIds: ['item-1'],
        direction: 'horizontal',
      });
      const messagesV = createListMessages('list-2', {
        childIds: ['item-1'],
        direction: 'vertical',
      });

      const {container: containerH} = render(
        <TestWrapper>
          <TestRenderer messages={messagesH} />
        </TestWrapper>,
      );
      const {container: containerV} = render(
        <TestWrapper>
          <TestRenderer messages={messagesV} />
        </TestWrapper>,
      );

      const listH = containerH.querySelector('.a2ui-list');
      const listV = containerV.querySelector('.a2ui-list');

      expect(listH?.getAttribute('data-direction')).toBe('horizontal');
      expect(listV?.getAttribute('data-direction')).toBe('vertical');
      expect(listH?.getAttribute('data-direction')).not.toBe(listV?.getAttribute('data-direction'));
    });
  });

  describe('Empty List', () => {
    it('should render empty list container', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'list-1',
            component: {
              List: {
                children: {explicitList: []},
              },
            },
          },
        ]),
        createBeginRendering('list-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const list = container.querySelector('.a2ui-list');
      expect(list).toBeInTheDocument();
      const section = list?.querySelector('section');
      expect(section).toBeInTheDocument();
    });
  });

  describe('Structure', () => {
    it('should have correct DOM structure: div > section > children', () => {
      const messages = createListMessages('list-1', {
        childIds: ['item-1', 'item-2'],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const list = container.querySelector('.a2ui-list');
      expect(list?.tagName).toBe('DIV');

      const section = list?.querySelector('section');
      expect(section).toBeInTheDocument();

      // Children should be inside section
      const children = section?.querySelectorAll('.a2ui-text');
      expect(children?.length).toBe(2);
    });
  });
});
