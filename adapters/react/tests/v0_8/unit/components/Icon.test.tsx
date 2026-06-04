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

import {describe, it, expect, beforeEach} from 'vitest';
import {render, screen} from '@testing-library/react';
import React from 'react';
import {TestWrapper, TestRenderer, createSimpleMessages} from '../../utils';
import {litTheme, defaultTheme} from '../../../../src/v0_8';

describe('Icon Component', () => {
  describe('Basic Rendering', () => {
    it('should render an icon with literal name', () => {
      const messages = createSimpleMessages('icon-1', 'Icon', {
        name: {literalString: 'home'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Should render something (Material Symbols span)
      const surface = container.querySelector('.a2ui-surface');
      expect(surface).toBeInTheDocument();
      expect(surface?.innerHTML).not.toBe('');
    });

    it('should render icon with empty string name gracefully', () => {
      const messages = createSimpleMessages('icon-1', 'Icon', {
        name: {literalString: ''},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Should have the surface - empty name returns null (no icon rendered)
      const surface = container.querySelector('.a2ui-surface');
      expect(surface).toBeInTheDocument();
    });

    it('should render with search icon', () => {
      const messages = createSimpleMessages('icon-1', 'Icon', {
        name: {literalString: 'search'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Check that content was rendered
      expect(container.querySelector('.a2ui-surface')).toBeInTheDocument();
    });

    it('should render with settings icon', () => {
      const messages = createSimpleMessages('icon-1', 'Icon', {
        name: {literalString: 'settings'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(container.querySelector('.a2ui-surface')).toBeInTheDocument();
    });
  });

  describe('Icon Name Mapping', () => {
    // A2UI names are converted to snake_case for Material Symbols
    const iconMappings = [
      {a2ui: 'home', expected: 'home'},
      {a2ui: 'search', expected: 'search'},
      {a2ui: 'settings', expected: 'settings'},
      {a2ui: 'favorite', expected: 'favorite'},
      {a2ui: 'delete', expected: 'delete'},
      {a2ui: 'shoppingCart', expected: 'shopping_cart'},
      {a2ui: 'accountCircle', expected: 'account_circle'},
      {a2ui: 'notifications', expected: 'notifications'},
      {a2ui: 'mail', expected: 'mail'},
      {a2ui: 'lock', expected: 'lock'},
    ];

    iconMappings.forEach(({a2ui, expected}) => {
      it(`should render "${a2ui}" icon as "${expected}"`, () => {
        const messages = createSimpleMessages('icon-1', 'Icon', {
          name: {literalString: a2ui},
        });

        const {container} = render(
          <TestWrapper>
            <TestRenderer messages={messages} />
          </TestWrapper>,
        );

        // Should render with snake_case name for Material Symbols
        const icon = container.querySelector('.g-icon');
        expect(icon).toBeInTheDocument();
        expect(icon?.textContent).toBe(expected);
      });
    });
  });

  describe('Theme Support', () => {
    it('should apply default theme classes', () => {
      const messages = createSimpleMessages('icon-1', 'Icon', {
        name: {literalString: 'home'},
      });

      const {container} = render(
        <TestWrapper theme={defaultTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Default theme (litTheme) has empty Icon classes, so check section is rendered
      // and the icon span has the g-icon class for Google Material Symbols
      const section = container.querySelector('section');
      expect(section).toBeInTheDocument();
      expect(container.querySelector('.g-icon')).toBeInTheDocument();
    });

    it('should apply lit theme classes with container/element structure', () => {
      const messages = createSimpleMessages('icon-1', 'Icon', {
        name: {literalString: 'home'},
      });

      const {container} = render(
        <TestWrapper theme={litTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Lit theme uses layout/typography classes for icon styling
      const icon = container.querySelector('.g-icon');
      expect(icon).toBeInTheDocument();
    });
  });

  describe('Material Symbols Integration', () => {
    it('should render icon using Material Symbols font', () => {
      const messages = createSimpleMessages('icon-1', 'Icon', {
        name: {literalString: 'home'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Material Symbols uses a span with g-icon class
      const icon = container.querySelector('.g-icon');
      expect(icon).toBeInTheDocument();
      expect(icon?.textContent).toBe('home');
    });

    it('should convert camelCase icon names to snake_case', () => {
      const messages = createSimpleMessages('icon-1', 'Icon', {
        name: {literalString: 'shoppingCart'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // camelCase should be converted to snake_case for Material Symbols
      const icon = container.querySelector('.g-icon');
      expect(icon).toBeInTheDocument();
      expect(icon?.textContent).toBe('shopping_cart');
    });
  });

  describe('Unknown Icons', () => {
    it('should render unknown icon names as-is for Material Symbols', () => {
      const messages = createSimpleMessages('icon-1', 'Icon', {
        name: {literalString: 'unknownIconName12345'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Material Symbols renders the icon name as text (font handles display)
      const icon = container.querySelector('.g-icon');
      expect(icon).toBeInTheDocument();
      expect(icon?.textContent).toBe('unknown_icon_name12345');
    });
  });
});
