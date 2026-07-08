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

describe('Example: Formatted Text', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('00_formatted-text.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Type something:');
    expect(textContent).toContain('Formatted output:');
  });

  it('should update result text when typing in the input field', async () => {
    const inputs = querySelectorAllDeep(surface, 'input') as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(1);

    const input = inputs[0];
    input.value = 'hello world';
    input.dispatchEvent(new Event('input'));

    await whenSettled(gallery);

    const updatedText = getDeepTextContent(surface);
    expect(updatedText).toContain('You typed: hello world');
  });
});
