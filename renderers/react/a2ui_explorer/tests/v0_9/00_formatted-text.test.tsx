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

describe('Example: Formatted Text', () => {
  let container: HTMLDivElement;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    container = await loadExample('00_formatted-text.json');
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Type something:');
    expect(textContent).toContain('Formatted output:');
  });

  it('should update result text when typing in the input field', async () => {
    const inputs = Array.from(surface.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(1);

    const input = inputs[0];
    await act(async () => {
      changeInputValue(input, 'hello world');
      await whenSettled();
    });

    const updatedText = surface.textContent || '';
    expect(updatedText).toContain('You typed: hello world');
  });
});
