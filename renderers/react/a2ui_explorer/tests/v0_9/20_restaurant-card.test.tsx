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

import {loadExample, cleanup, getSurface} from '../utils/test-utils';
describe('Example: Restaurant Card', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('20_restaurant-card.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render text content', async () => {
    expect(textContent).toContain('The Italian Kitchen');
    expect(textContent).toContain('$$$');
    expect(textContent).toContain('Italian');
    expect(textContent).toContain('4.8');
    expect(textContent).toContain('2,847 reviews');
    expect(textContent).toContain('0.8 mi');
    expect(textContent).toContain('25-35 min');
  });

  it('should render image', async () => {
    const img = Array.from(surface.querySelectorAll('img'))[0] as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=300&h=150&fit=crop',
    );
  });

  it('should render icon', async () => {
    expect(
      Array.from(
        surface.querySelectorAll('.material-symbols-outlined, .a2ui-icon'),
      )[0] as HTMLElement,
    ).toBeTruthy();
  });
});
