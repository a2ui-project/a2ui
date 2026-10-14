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

describe('Example: Native React Grid', () => {
  let container: HTMLDivElement;
  let surface: HTMLElement;

  beforeEach(async () => {
    container = await loadExample('37_native-grid.json');
    surface = getSurface(container);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should render the native container component and header content', () => {
    expect(surface.textContent).toContain('Native Container Component Showcase');
    expect(surface.textContent).toContain('Interactive 2x2 Component Grid');
    expect(surface.querySelector('a2ui-react-customgrid')).toBeTruthy();
  });

  it('should instantiate custom component children (CustomSlider)', () => {
    const customSliders = surface.querySelectorAll('a2ui-react-customslider');
    expect(customSliders.length).toBe(3);
    expect(customSliders[0]?.textContent).toContain('Master Volume (Native)');
    expect(customSliders[1]?.textContent).toContain('Contrast (Native, inside universal Card)');
    expect(customSliders[2]?.textContent).toContain('Brightness Level (Native)');
  });

  it('should host a native component inside a universal component', async () => {
    const nested = surface.querySelectorAll('a2ui-card a2ui-react-customslider');
    expect(nested.length).toBe(1);
    expect(nested[0]?.textContent).toContain('Contrast (Native, inside universal Card)');

    const slider = nested[0]!.querySelector('input[type="range"]') as HTMLInputElement;
    await act(async () => {
      changeInputValue(slider, '80');
      await whenSettled();
    });

    expect(surface.textContent).toContain('Contrast: 80%');
  });

  it('should instantiate child components (Card, Text, Button)', () => {
    expect(surface.textContent).toContain('Universal Web Component: Text & Card');
    expect(surface.textContent).toContain('Universal Button Action');
  });

  it('should update reactive data binding across native and custom components', async () => {
    const [volume] = Array.from(surface.querySelectorAll('a2ui-react-customslider'));
    expect(volume?.textContent).toContain('Master Volume (Native)');
    const slider = volume!.querySelector('input[type="range"]') as HTMLInputElement;

    await act(async () => {
      changeInputValue(slider, '80');
      await whenSettled();
    });

    expect(surface.textContent).toContain('Vol: 80% | Bright: 30%');
  });
});
