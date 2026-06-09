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
  findButtonByText,
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Coffee Order', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('13_coffee-order.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Subtotal');
    expect(textContent).toContain('Tax');
    expect(textContent).toContain('Total');
    expect(textContent).toContain('Purchase');
    expect(textContent).toContain('Add to cart');
    expect(textContent).toContain('Sunrise Coffee');
    expect(textContent).toContain('Oat Milk Latte');
    expect(textContent).toContain('Grande, Extra Shot');
    expect(textContent).toContain('Chocolate Croissant');
    expect(textContent).toContain('Warmed');
  });

  it('should render icon', async () => {
    expect(querySelectorAllDeep(surface, 'a2ui-icon')[0] as HTMLElement).toBeTruthy();
    expect(textContent).toContain('favorite');
  });

  it('should handle Purchase button click', async () => {
    const purchaseBtn = await findButtonByText(surface, 'Purchase');

    purchaseBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('purchase');
  });

  it('should handle Add to cart button click', async () => {
    const addToCartBtn = await findButtonByText(surface, 'Add to cart');

    addToCartBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('add_to_cart');
  });
});
