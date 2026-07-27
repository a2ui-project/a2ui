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
import {render, screen} from '@testing-library/react';
import React from 'react';
import {TestWrapper, TestRenderer, createSurfaceUpdate, createBeginRendering} from '../../utils';
import type * as Types from '@a2ui/web_core/types/types';

/**
 * Card tests following A2UI specification.
 * Required: child (component ID string)
 */
describe('Card Component', () => {
  describe('Basic Rendering', () => {
    it('should render a section element', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Card content'}, usageHint: 'body'}},
          },
          {id: 'card-1', component: {Card: {child: 'text-1'}}},
        ]),
        createBeginRendering('card-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      expect(section).toBeInTheDocument();
    });

    it('should render with wrapper div', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Content'}, usageHint: 'body'}},
          },
          {id: 'card-1', component: {Card: {child: 'text-1'}}},
        ]),
        createBeginRendering('card-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-card');
      expect(wrapper).toBeInTheDocument();
    });
  });

  describe('Child Rendering', () => {
    it('should render child Text component', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Card content'}, usageHint: 'body'}},
          },
          {id: 'card-1', component: {Card: {child: 'text-1'}}},
        ]),
        createBeginRendering('card-1'),
      ];

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(screen.getByText('Card content')).toBeInTheDocument();
    });

    it('should render nested Button in Card', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'btn-text',
            component: {Text: {text: {literalString: 'Click me'}, usageHint: 'body'}},
          },
          {id: 'btn-1', component: {Button: {child: 'btn-text', action: {name: 'click'}}}},
          {id: 'card-1', component: {Card: {child: 'btn-1'}}},
        ]),
        createBeginRendering('card-1'),
      ];

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(screen.getByRole('button')).toBeInTheDocument();
      expect(screen.getByText('Click me')).toBeInTheDocument();
    });
  });

  describe('Theme Support', () => {
    it('should apply theme classes to section', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Content'}, usageHint: 'body'}},
          },
          {id: 'card-1', component: {Card: {child: 'text-1'}}},
        ]),
        createBeginRendering('card-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      // Verify section has className that is defined and has classes applied
      expect(section?.className).toBeDefined();
      expect(typeof section?.className).toBe('string');
      expect(section?.classList.length).toBeGreaterThan(0);
    });
  });

  describe('Structure', () => {
    it('should have correct DOM structure', () => {
      const messages: Types.ServerToClientMessage[] = [
        createSurfaceUpdate([
          {
            id: 'text-1',
            component: {Text: {text: {literalString: 'Content'}, usageHint: 'body'}},
          },
          {id: 'card-1', component: {Card: {child: 'text-1'}}},
        ]),
        createBeginRendering('card-1'),
      ];

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-card');
      expect(wrapper?.children.length).toBe(1);
      expect(wrapper?.children[0]?.tagName).toBe('SECTION');
    });
  });
});
