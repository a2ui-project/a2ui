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
import {render, fireEvent} from '@testing-library/react';
import React from 'react';
import {TestWrapper, TestRenderer, createSimpleMessages} from '../../utils';

/**
 * MultipleChoice tests following A2UI specification.
 * Required: selections, options (array of { label, value })
 * Optional: maxAllowedSelections
 *
 * Renders a <select> dropdown matching Lit renderer behavior.
 */
describe('MultipleChoice Component', () => {
  describe('Basic Rendering', () => {
    it('should render a select element', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [
          {label: {literalString: 'Option A'}, value: 'a'},
          {label: {literalString: 'Option B'}, value: 'b'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const select = container.querySelector('select');
      expect(select).toBeInTheDocument();
      expect(select?.tagName).toBe('SELECT');
    });

    it('should render with wrapper div having correct class', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [{label: {literalString: 'Option A'}, value: 'a'}],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-multiplechoice');
      expect(wrapper).toBeInTheDocument();
      expect(wrapper?.tagName).toBe('DIV');
    });

    it('should render all option labels', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [
          {label: {literalString: 'First Option'}, value: 'first'},
          {label: {literalString: 'Second Option'}, value: 'second'},
          {label: {literalString: 'Third Option'}, value: 'third'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const options = container.querySelectorAll('option');
      expect(options.length).toBe(3);
      expect(options[0]?.textContent).toBe('First Option');
      expect(options[1]?.textContent).toBe('Second Option');
      expect(options[2]?.textContent).toBe('Third Option');
    });

    it('should render correct number of options', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [
          {label: {literalString: 'A'}, value: 'a'},
          {label: {literalString: 'B'}, value: 'b'},
          {label: {literalString: 'C'}, value: 'c'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const options = container.querySelectorAll('option');
      expect(options.length).toBe(3);
    });

    it('should render different options for different inputs', () => {
      const messages1 = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections1'},
        options: [{label: {literalString: 'Alpha'}, value: 'alpha'}],
      });
      const messages2 = createSimpleMessages('mc-2', 'MultipleChoice', {
        selections: {path: '/mcSelections2'},
        options: [
          {label: {literalString: 'Beta'}, value: 'beta'},
          {label: {literalString: 'Gamma'}, value: 'gamma'},
        ],
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

      expect(container1.textContent).toContain('Alpha');
      expect(container1.textContent).not.toContain('Beta');
      expect(container2.textContent).toContain('Beta');
      expect(container2.textContent).toContain('Gamma');
      expect(container2.textContent).not.toContain('Alpha');
    });
  });

  describe('Description Label', () => {
    it('should render default description when not provided', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [{label: {literalString: 'Option A'}, value: 'a'}],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const label = container.querySelector('label');
      expect(label).toBeInTheDocument();
      expect(label?.textContent).toBe('Select an item');
    });

    it('should associate label with select via htmlFor', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [{label: {literalString: 'Option A'}, value: 'a'}],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const label = container.querySelector('label');
      const select = container.querySelector('select');
      expect(label?.getAttribute('for')).toBe(select?.id);
    });
  });

  describe('Option Values', () => {
    it('should set correct value attributes on options', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [
          {label: {literalString: 'Small'}, value: 'sm'},
          {label: {literalString: 'Medium'}, value: 'md'},
          {label: {literalString: 'Large'}, value: 'lg'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const options = container.querySelectorAll('option');
      expect(options[0]?.value).toBe('sm');
      expect(options[1]?.value).toBe('md');
      expect(options[2]?.value).toBe('lg');
    });
  });

  describe('User Interaction', () => {
    it('should update select value on change', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [
          {label: {literalString: 'Option A'}, value: 'a'},
          {label: {literalString: 'Option B'}, value: 'b'},
          {label: {literalString: 'Option C'}, value: 'c'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const select = container.querySelector('select') as HTMLSelectElement;
      fireEvent.change(select, {target: {value: 'b'}});

      expect(select.value).toBe('b');
    });

    it('should handle multiple sequential changes', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [
          {label: {literalString: 'Option A'}, value: 'a'},
          {label: {literalString: 'Option B'}, value: 'b'},
          {label: {literalString: 'Option C'}, value: 'c'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const select = container.querySelector('select') as HTMLSelectElement;

      fireEvent.change(select, {target: {value: 'a'}});
      expect(select.value).toBe('a');

      fireEvent.change(select, {target: {value: 'c'}});
      expect(select.value).toBe('c');

      fireEvent.change(select, {target: {value: 'b'}});
      expect(select.value).toBe('b');
    });
  });

  describe('Structure', () => {
    it('should have correct DOM structure: div > section > label + select', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [
          {label: {literalString: 'Option A'}, value: 'a'},
          {label: {literalString: 'Option B'}, value: 'b'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-multiplechoice');
      expect(wrapper?.tagName).toBe('DIV');

      const section = wrapper?.querySelector('section');
      expect(section).toBeInTheDocument();

      const children = Array.from(section?.children ?? []);
      expect(children.length).toBe(2);
      expect(children[0]?.tagName).toBe('LABEL');
      expect(children[1]?.tagName).toBe('SELECT');
    });

    it('should have select inside section container', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [{label: {literalString: 'Option A'}, value: 'a'}],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      const select = section?.querySelector('select');
      expect(select).toBeInTheDocument();
    });

    it('should have options inside select', () => {
      const messages = createSimpleMessages('mc-1', 'MultipleChoice', {
        selections: {path: '/mcSelections'},
        options: [
          {label: {literalString: 'Option A'}, value: 'a'},
          {label: {literalString: 'Option B'}, value: 'b'},
        ],
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const select = container.querySelector('select');
      const options = select?.querySelectorAll('option');
      expect(options?.length).toBe(2);
    });
  });
});
