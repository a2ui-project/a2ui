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
 * Slider tests following A2UI specification.
 * Required: value
 * Optional: minValue, maxValue
 */
describe('Slider Component', () => {
  describe('Basic Rendering', () => {
    it('should render a range input', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 50},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input[type="range"]');
      expect(input).toBeInTheDocument();
      expect(input?.tagName).toBe('INPUT');
      expect(input?.getAttribute('type')).toBe('range');
    });

    it('should render with wrapper div having correct class', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 50},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-slider');
      expect(wrapper).toBeInTheDocument();
      expect(wrapper?.tagName).toBe('DIV');
    });

    it('should render with exact initial value', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 75},
        minValue: 0,
        maxValue: 100,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input[type="range"]') as HTMLInputElement;
      expect(input.value).toBe('75');
      // Verify it's not some default value
      expect(input.value).not.toBe('50');
      expect(input.value).not.toBe('0');
    });

    it('should display current value in span matching input value', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 42},
        minValue: 0,
        maxValue: 100,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input[type="range"]') as HTMLInputElement;
      const span = container.querySelector('section span');

      // Both should show the same value
      expect(span?.textContent).toBe('42');
      expect(input.value).toBe('42');
    });

    it('should render different values for different inputs', () => {
      const messages1 = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 25},
        minValue: 0,
        maxValue: 100,
      });
      const messages2 = createSimpleMessages('sl-2', 'Slider', {
        value: {literalNumber: 75},
        minValue: 0,
        maxValue: 100,
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

      const input1 = container1.querySelector('input[type="range"]') as HTMLInputElement;
      const input2 = container2.querySelector('input[type="range"]') as HTMLInputElement;

      expect(input1.value).toBe('25');
      expect(input2.value).toBe('75');
      expect(input1.value).not.toBe(input2.value);
    });
  });

  describe('Min/Max Values', () => {
    it('should set exact min attribute value', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 50},
        minValue: 10,
        maxValue: 100,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input[type="range"]') as HTMLInputElement;
      expect(input.min).toBe('10');
      expect(input.min).not.toBe('0'); // Not default
    });

    it('should set exact max attribute value', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 50},
        minValue: 0,
        maxValue: 200,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input[type="range"]') as HTMLInputElement;
      expect(input.max).toBe('200');
      expect(input.max).not.toBe('100'); // Not default HTML value
    });

    it('should default min/max to 0 when not provided', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 0},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input[type="range"]') as HTMLInputElement;
      expect(input.min).toBe('0');
      expect(input.max).toBe('0');
    });

    it('should handle negative min values', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 0},
        minValue: -100,
        maxValue: 100,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input[type="range"]') as HTMLInputElement;
      expect(input.min).toBe('-100');
    });
  });

  describe('User Interaction', () => {
    it('should update input value on change', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 50},
        minValue: 0,
        maxValue: 100,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input[type="range"]') as HTMLInputElement;
      expect(input.value).toBe('50'); // Initial value

      fireEvent.change(input, {target: {value: '80'}});

      expect(input.value).toBe('80'); // New value
      expect(input.value).not.toBe('50'); // Not old value
    });

    it('should update displayed span value in sync with input', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 50},
        minValue: 0,
        maxValue: 100,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input[type="range"]') as HTMLInputElement;
      const span = container.querySelector('section span');

      expect(span?.textContent).toBe('50'); // Initial

      fireEvent.change(input, {target: {value: '25'}});

      // Both should update together
      expect(input.value).toBe('25');
      expect(span?.textContent).toBe('25');
    });

    it('should handle multiple sequential value changes', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 50},
        minValue: 0,
        maxValue: 100,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const input = container.querySelector('input[type="range"]') as HTMLInputElement;
      const span = container.querySelector('section span');

      fireEvent.change(input, {target: {value: '10'}});
      expect(input.value).toBe('10');
      expect(span?.textContent).toBe('10');

      fireEvent.change(input, {target: {value: '90'}});
      expect(input.value).toBe('90');
      expect(span?.textContent).toBe('90');

      fireEvent.change(input, {target: {value: '50'}});
      expect(input.value).toBe('50');
      expect(span?.textContent).toBe('50');
    });
  });

  describe('Structure', () => {
    it('should have correct DOM structure: label, input, span in order', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 50},
        label: {literalString: 'Volume'},
        minValue: 0,
        maxValue: 100,
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      expect(section).toBeInTheDocument();

      const children = Array.from(section?.children ?? []);
      expect(children.length).toBe(3);
      expect(children[0]?.tagName).toBe('LABEL');
      expect(children[1]?.tagName).toBe('INPUT');
      expect(children[2]?.tagName).toBe('SPAN');
    });

    it('should omit label from DOM structure when not provided', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 50},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      expect(section).toBeInTheDocument();

      const children = Array.from(section?.children ?? []);
      expect(children.length).toBe(2);
      expect(children[0]?.tagName).toBe('INPUT');
      expect(children[1]?.tagName).toBe('SPAN');
    });

    it('should have input inside section container', () => {
      const messages = createSimpleMessages('sl-1', 'Slider', {
        value: {literalNumber: 50},
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      const input = section?.querySelector('input[type="range"]');
      expect(input).toBeInTheDocument();
    });
  });
});
