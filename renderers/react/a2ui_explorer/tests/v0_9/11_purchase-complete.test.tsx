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
describe('Example: Purchase Complete', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('11_purchase-complete.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Purchase Complete');
    expect(textContent).toContain('Wireless Headphones Pro');
    expect(textContent).toContain('Arrives Dec 18 - Dec 20');
    expect(textContent).toContain('Sold by:');
    expect(textContent).toContain('TechStore Official');
    expect(textContent).toContain('View Order Details');

    // Check for formatted currency
    expect(textContent).toContain('199.99');
  });

  it('should render image', async () => {
    const img = Array.from(surface.querySelectorAll('img'))[0] as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=100&h=100&fit=crop',
    );
  });

  it('should render icons', async () => {
    expect(textContent).toContain('check');
    expect(textContent).toContain('arrow_forward');
  });

  it('should handle button click', async () => {
    const button = surface.querySelector('button') as HTMLButtonElement;
    expect(button).withContext('Should find View Order Details button').toBeTruthy();

    await act(async () => {
      button.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('view_details');
  });
});
