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

import {
  loadExample,
  getSurface,
  getDeepTextContent,
  querySelectorAllDeep,
  whenSettled,
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Advanced Form Validator', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('32_advanced-form-validator.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
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
    const inputs = querySelectorAllDeep(surface, 'input') as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(4);
  });

  it('should show error for invalid email', async () => {
    const inputs = querySelectorAllDeep(surface, 'input') as HTMLInputElement[];
    const textInputs = inputs.filter(i => i.type === 'text' || !i.type);

    const emailInput = textInputs[0];
    emailInput.value = 'invalid-email';
    emailInput.dispatchEvent(new Event('input'));
    await whenSettled(gallery);

    expect(textContent).toContain('Invalid email format');
  });

  it('should show error for invalid phone', async () => {
    const inputs = querySelectorAllDeep(surface, 'input') as HTMLInputElement[];
    const textInputs = inputs.filter(i => i.type === 'text' || !i.type);

    const phoneInput = textInputs[1];
    phoneInput.value = '123';
    phoneInput.dispatchEvent(new Event('input'));
    await whenSettled(gallery);

    expect(textContent).toContain('Invalid phone format');
  });

  it('should show error for invalid zip', async () => {
    const inputs = querySelectorAllDeep(surface, 'input') as HTMLInputElement[];
    const textInputs = inputs.filter(i => i.type === 'text' || !i.type);

    const zipInput = textInputs[2];
    zipInput.value = '1234';
    zipInput.dispatchEvent(new Event('input'));
    await whenSettled(gallery);

    expect(textContent).toContain('Must be exactly 5 digits');
  });
});
