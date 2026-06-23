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
import {loadExample, cleanup, getSurface, findButtonByText, whenSettled} from '../utils/test-utils';
describe('Example: Coffee Order', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('13_coffee-order.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
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
    expect(
      Array.from(
        surface.querySelectorAll('.material-symbols-outlined, .a2ui-icon'),
      )[0] as HTMLElement,
    ).toBeTruthy();
    expect(textContent).toContain('favorite');
  });

  it('should handle Purchase button click', async () => {
    const purchaseBtn = await findButtonByText(surface, 'Purchase');

    await act(async () => {
      purchaseBtn.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('purchase');
  });

  it('should handle Add to cart button click', async () => {
    const addToCartBtn = await findButtonByText(surface, 'Add to cart');

    await act(async () => {
      addToCartBtn.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('add_to_cart');
  });
});
