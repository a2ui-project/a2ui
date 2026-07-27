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
 * DateTimeInput tests following A2UI specification.
 * Required: value
 * Optional: enableDate (default true), enableTime (default false)
 */
describe('DateTimeInput Component', () => {
  describe('Basic Rendering', () => {
    it('should render an input element', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input');
      expect(input).toBeInTheDocument();
    });

    it('should render with wrapper div', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-datetime-input');
      expect(wrapper).toBeInTheDocument();
    });

    it('should render with initial value', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-06-20'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('2024-06-20');
    });

    it('should render different values for different inputs', () => {
      const messages1 = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-01'},
      });
      const messages2 = createSimpleMessages('dt-2', 'DateTimeInput', {
        value: {literalString: '2024-12-31'},
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

      const input1 = container1.querySelector('input') as HTMLInputElement;
      const input2 = container2.querySelector('input') as HTMLInputElement;

      expect(input1.value).toBe('2024-01-01');
      expect(input2.value).toBe('2024-12-31');
      expect(input1.value).not.toBe(input2.value);
    });
  });

  describe('Input Type', () => {
    it('should render date input by default (enableDate=true, enableTime=false)', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input');
      expect(input?.type).toBe('date');
      expect(input?.type).not.toBe('time');
      expect(input?.type).not.toBe('datetime-local');
    });

    it('should render date input when enableDate=true', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15'},
        enableDate: true,
        enableTime: false,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input');
      expect(input?.type).toBe('date');
    });

    it('should render time input when enableTime=true and enableDate=false', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '14:30'},
        enableDate: false,
        enableTime: true,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input');
      expect(input?.type).toBe('time');
      expect(input?.type).not.toBe('date');
    });

    it('should render datetime-local input when both enableDate and enableTime are true', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15T14:30'},
        enableDate: true,
        enableTime: true,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input');
      expect(input?.type).toBe('datetime-local');
      expect(input?.type).not.toBe('date');
      expect(input?.type).not.toBe('time');
    });

    it('should render different input types for different configurations', () => {
      const messagesDate = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15'},
        enableDate: true,
        enableTime: false,
      });
      const messagesTime = createSimpleMessages('dt-2', 'DateTimeInput', {
        value: {literalString: '14:30'},
        enableDate: false,
        enableTime: true,
      });

      const {container: containerDate} = render(
        <TestWrapper>
          <TestRenderer messages={messagesDate} />
        </TestWrapper>,
      );
      const {container: containerTime} = render(
        <TestWrapper>
          <TestRenderer messages={messagesTime} />
        </TestWrapper>,
      );

      const inputDate = containerDate.querySelector('input');
      const inputTime = containerTime.querySelector('input');

      expect(inputDate?.type).toBe('date');
      expect(inputTime?.type).toBe('time');
      expect(inputDate?.type).not.toBe(inputTime?.type);
    });
  });

  describe('Label', () => {
    it('should render "Date" label for date input', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15'},
        enableDate: true,
        enableTime: false,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const label = container.querySelector('label');
      expect(label?.textContent).toBe('Date');
    });

    it('should render "Time" label for time input', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '14:30'},
        enableDate: false,
        enableTime: true,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const label = container.querySelector('label');
      expect(label?.textContent).toBe('Time');
    });

    it('should render "Date & Time" label for datetime input', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15T14:30'},
        enableDate: true,
        enableTime: true,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const label = container.querySelector('label');
      expect(label?.textContent).toBe('Date & Time');
    });

    it('should associate label with input via htmlFor', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const label = container.querySelector('label');
      const input = container.querySelector('input');
      expect(label?.getAttribute('for')).toBe(input?.id);
    });
  });

  describe('User Interaction', () => {
    it('should update value on change', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('2024-01-15');

      fireEvent.change(input, {target: {value: '2024-06-20'}});

      expect(input.value).toBe('2024-06-20');
      expect(input.value).not.toBe('2024-01-15');
    });

    it('should update time value on change', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '10:00'},
        enableDate: false,
        enableTime: true,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('10:00');

      fireEvent.change(input, {target: {value: '18:30'}});

      expect(input.value).toBe('18:30');
      expect(input.value).not.toBe('10:00');
    });
  });

  describe('Structure', () => {
    it('should have correct DOM structure: div > section > label + input', () => {
      const messages = createSimpleMessages('dt-1', 'DateTimeInput', {
        value: {literalString: '2024-01-15'},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-datetime-input');
      expect(wrapper?.tagName).toBe('DIV');

      const section = wrapper?.querySelector('section');
      expect(section).toBeInTheDocument();

      const children = Array.from(section?.children ?? []);
      expect(children.length).toBe(2);
      expect(children[0]?.tagName).toBe('LABEL');
      expect(children[1]?.tagName).toBe('INPUT');
    });
  });
});
