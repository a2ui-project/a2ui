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

import {
  loadExample,
  getSurface,
  getDeepTextContent,
  querySelectorAllDeep,
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

async function waitForText(surface: HTMLElement, expected: string, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (getDeepTextContent(surface).includes(expected)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for "${expected}" in "${getDeepTextContent(surface)}"`);
}

describe('Example: Srcdoc Tip Calculator', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  beforeEach(async () => {
    gallery = await loadExample('srcdoc-tip-calculator.json');
    surface = getSurface(gallery);
    await waitForText(surface, 'Total to pay: $75.52');
  });

  afterEach(() => {
    gallery?.remove();
  });

  it('renders the sandboxed tip calculator and computes initial totals from seeded data', () => {
    const textContent = getDeepTextContent(surface);
    expect(textContent).toContain('Tip calculator');
    expect(textContent).toContain('Bill amount');
    expect(textContent).toContain('Tip percent');
    expect(textContent).toContain('Total to pay: $75.52');
    expect(querySelectorAllDeep(surface, 'a2ui-web-app-frame-srcdoc iframe').length).toBe(1);
  });

  it('recomputes totals when the host bill text field is updated', async () => {
    const [billInput] = querySelectorAllDeep(surface, 'input') as HTMLInputElement[];
    expect(billInput).toBeTruthy();

    billInput.value = '100';
    billInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));

    await waitForText(surface, 'Total to pay: $118.00');
  });
});
