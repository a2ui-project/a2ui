/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {act} from 'react';
import {loadExample, cleanup, getSurface, whenSettled} from '../utils/test-utils';

function changeInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', {bubbles: true}));
}

for (const useUniversal of [false, true]) {
  describe(`Example: Native React Grid (useUniversalComponents: ${useUniversal})`, () => {
    let container: HTMLDivElement;
    let surface: HTMLElement;

    beforeEach(async () => {
      container = await loadExample('37_native-grid.json', {useUniversalComponents: useUniversal});
      surface = getSurface(container);
    });

    afterEach(async () => {
      await cleanup();
    });

    it('should render the native container component and header content', () => {
      expect(surface.textContent).toContain('Native Container Component Showcase');
      expect(surface.textContent).toContain('Interactive 2x2 Component Grid');
      expect(
        surface.querySelector('.custom-grid-wrapper') || surface.querySelector('a2ui-react-grid'),
      ).toBeTruthy();
    });

    it('should instantiate custom component children (CustomSlider)', () => {
      const customSliders = surface.querySelectorAll('.custom-slider-container');
      expect(customSliders.length).toBe(2);
      expect(customSliders[0]?.textContent).toContain('Master Volume (Native)');
      expect(customSliders[1]?.textContent).toContain('Brightness Level (Native)');
    });

    it('should instantiate child components (Card, Text, Button)', () => {
      expect(surface.textContent).toContain('Universal Web Component: Text & Card');
      expect(surface.textContent).toContain('Universal Button Action');
    });

    it('should update reactive data binding across native and custom components', async () => {
      const slider = surface.querySelector(
        '.custom-slider-container input[type="range"], a2ui-react-customslider input[type="range"]',
      ) as HTMLInputElement;
      expect(slider).toBeTruthy();

      await act(async () => {
        changeInputValue(slider, '80');
        await whenSettled();
      });

      expect(surface.textContent).toContain('Vol: 80% | Bright: 30%');
    });
  });
}
