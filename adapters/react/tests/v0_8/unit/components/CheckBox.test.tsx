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
import {TestWrapper, TestRenderer, createSimpleMessages} from '../../utils';

/**
 * CheckBox tests following A2UI specification.
 * Required: label, value
 */
describe('CheckBox Component', () => {
  describe('Basic Rendering', () => {
    it('should render a checkbox input', () => {
      const messages = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Accept terms'},
        value: {literalBoolean: false},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const checkbox = container.querySelector('input[type="checkbox"]');
      expect(checkbox).toBeInTheDocument();
    });

    it('should render with wrapper div', () => {
      const messages = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Subscribe'},
        value: {literalBoolean: false},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-checkbox');
      expect(wrapper).toBeInTheDocument();
    });

    it('should render unchecked when value is false', () => {
      const messages = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Option'},
        value: {literalBoolean: false},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('should render checked when value is true', () => {
      const messages = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Option'},
        value: {literalBoolean: true},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('should render different states for different value inputs', () => {
      const messagesTrue = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Checked option'},
        value: {literalBoolean: true},
      });
      const messagesFalse = createSimpleMessages('cb-2', 'CheckBox', {
        label: {literalString: 'Unchecked option'},
        value: {literalBoolean: false},
      });

      const {container: containerTrue} = render(
        <TestWrapper>
          <TestRenderer messages={messagesTrue} />
        </TestWrapper>,
      );
      const {container: containerFalse} = render(
        <TestWrapper>
          <TestRenderer messages={messagesFalse} />
        </TestWrapper>,
      );

      const checkboxTrue = containerTrue.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      const checkboxFalse = containerFalse.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;

      expect(checkboxTrue.checked).toBe(true);
      expect(checkboxFalse.checked).toBe(false);
      // Verify they're different states
      expect(checkboxTrue.checked).not.toBe(checkboxFalse.checked);
    });

    it('should render different labels for different inputs', () => {
      const messages1 = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'First Option'},
        value: {literalBoolean: false},
      });
      const messages2 = createSimpleMessages('cb-2', 'CheckBox', {
        label: {literalString: 'Second Option'},
        value: {literalBoolean: false},
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

      const label1 = container1.querySelector('label');
      const label2 = container2.querySelector('label');

      expect(label1?.textContent).toBe('First Option');
      expect(label2?.textContent).toBe('Second Option');
      expect(label1?.textContent).not.toBe(label2?.textContent);
    });
  });

  describe('Label Rendering', () => {
    it('should render label (required field)', () => {
      const messages = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Accept terms and conditions'},
        value: {literalBoolean: false},
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(screen.getByText('Accept terms and conditions')).toBeInTheDocument();
    });

    it('should associate label with checkbox via htmlFor', () => {
      const messages = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Remember me'},
        value: {literalBoolean: false},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const label = container.querySelector('label');
      const checkbox = container.querySelector('input[type="checkbox"]');
      expect(label?.getAttribute('for')).toBe(checkbox?.id);
    });
  });

  describe('User Interaction', () => {
    it('should toggle checked state on click', () => {
      const messages = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Toggle me'},
        value: {literalBoolean: false},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
    });

    it('should toggle via change event', () => {
      const messages = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Option'},
        value: {literalBoolean: false},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      fireEvent.change(checkbox, {target: {checked: true}});

      expect(checkbox.checked).toBe(true);
    });
  });

  describe('Theme Support', () => {
    it('should render within section container', () => {
      const messages = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Option'},
        value: {literalBoolean: false},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      expect(section).toBeInTheDocument();
      expect(section?.querySelector('input[type="checkbox"]')).toBeInTheDocument();
    });
  });

  describe('Structure', () => {
    it('should render checkbox before label (Lit structure)', () => {
      const messages = createSimpleMessages('cb-1', 'CheckBox', {
        label: {literalString: 'Option label'},
        value: {literalBoolean: false},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      const children = section?.children;
      expect(children?.[0]?.tagName).toBe('INPUT');
      expect(children?.[1]?.tagName).toBe('LABEL');
    });
  });
});
