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
describe('Example: Advanced Form Validator', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('32_advanced-form-validator.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Hello! Today is');
    expect(textContent).toContain('Email Address');
    expect(textContent).toContain('Phone Number');
    expect(textContent).toContain('Zip Code');
    expect(textContent).toContain('I agree to the terms and conditions');
    expect(textContent).toContain('Submit Registration');
  });

  it('should render date', async () => {
    expect(textContent).toContain('December');
  });

  it('should render inputs', async () => {
    const inputs = Array.from(surface.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(4);
  });

  it('should show error for invalid email', async () => {
    const inputs = Array.from(surface.querySelectorAll('input')) as HTMLInputElement[];
    const textInputs = inputs.filter(i => i.type === 'text' || !i.type);

    const emailInput = textInputs[0];
    await act(async () => {
      emailInput.value = 'invalid-email';
      emailInput.dispatchEvent(new Event('input'));
      await whenSettled();
    });

    expect(textContent).toContain('Invalid email format');
  });

  it('should show error for invalid phone', async () => {
    const inputs = Array.from(surface.querySelectorAll('input')) as HTMLInputElement[];
    const textInputs = inputs.filter(i => i.type === 'text' || !i.type);

    const phoneInput = textInputs[1];
    await act(async () => {
      phoneInput.value = '123';
      phoneInput.dispatchEvent(new Event('input'));
      await whenSettled();
    });

    expect(textContent).toContain('Invalid phone format');
  });

  it('should show error for invalid zip', async () => {
    const inputs = Array.from(surface.querySelectorAll('input')) as HTMLInputElement[];
    const textInputs = inputs.filter(i => i.type === 'text' || !i.type);

    const zipInput = textInputs[2];
    await act(async () => {
      zipInput.value = '1234';
      zipInput.dispatchEvent(new Event('input'));
      await whenSettled();
    });

    expect(textContent).toContain('Must be exactly 5 digits');
  });
});
