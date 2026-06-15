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

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Example: Task Card', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('07_task-card.json');
    surface = getSurface(gallery);

    // Wait a bit more for dynamic components
    await wait(100);
    await whenSettled(gallery);

    textContent = getDeepTextContent(surface);
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Review pull request');
    expect(textContent).toContain('Review and approve the authentication module changes.');
    expect(textContent).toContain('Due');
    expect(textContent).toContain('Backend');
  });

  it('should render date time input', async () => {
    const inputs = querySelectorAllDeep(surface, 'input') as HTMLInputElement[];
    const dateTimeInput = inputs.find(i => i.type === 'datetime-local') as HTMLInputElement;
    expect(dateTimeInput).withContext('Should have a date time input element').toBeTruthy();
    expect(dateTimeInput.value).toContain('2025-12-15');
  });

  it('should render checkbox', async () => {
    const checkbox = querySelectorAllDeep(surface, 'input[type="checkbox"]')[0];
    expect(checkbox).withContext('Should have a checkbox').toBeTruthy();
  });

  it('should render icon', async () => {
    expect(querySelectorAllDeep(surface, 'a2ui-icon')[0] as HTMLElement)
      .withContext('Should have an icon')
      .toBeTruthy();
  });
});
