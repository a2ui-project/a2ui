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

import {ComponentFixture} from '@angular/core/testing';
import {DemoComponent} from '../../demo.component';
import {getCanvas, loadExample, wait} from '../utils';

describe('Example: Coffee Order', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let component: DemoComponent;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Coffee Order');
    component = fixture.componentInstance;
    textContent = getCanvas().textContent;
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
    expect(fixture.nativeElement.querySelector('.a2ui-icon')).toBeTruthy();
    expect(textContent).toContain('favorite');
  });

  it('should handle Purchase button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const purchaseBtn = buttons.find(b => b.textContent.includes('Purchase'))!;
    expect(purchaseBtn).withContext('Should find Purchase button').toBeTruthy();

    purchaseBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('purchase');
  });

  it('should handle Add to cart button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const addToCartBtn = buttons.find(b => b.textContent.includes('Add to cart'))!;
    expect(addToCartBtn).withContext('Should find Add to cart button').toBeTruthy();

    addToCartBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('add_to_cart');
  });
});
