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

describe('Example: Product Card', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('05_product-card.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Wireless Headphones Pro');
    expect(textContent).toContain('★★★★★');
    expect(textContent).toContain('2,847');
    expect(textContent).toContain('reviews');
    expect(textContent).toContain('Add to Cart');
  });

  it('should render formatted currency', async () => {
    expect(textContent).toContain('199.99');
    expect(textContent).toContain('249.99');
  });

  it('should render image', async () => {
    const img = querySelectorAllDeep(surface, 'img')[0] as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&h=200&fit=crop',
    );
  });

  it('should handle button click', async () => {
    const button = querySelectorAllDeep(surface, '.a2ui-button')[0] as HTMLButtonElement;
    expect(button).toBeTruthy();

    button.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('addToCart');
  });
});
