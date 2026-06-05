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
import {Version, getCanvas, loadExample, wait} from '../utils/test_utils';

describe('Example: Coffee Order (basic) (v0.8)', () => {
  let textContent: string;
  let fixture: ComponentFixture<DemoComponent>;

  beforeEach(async () => {
    fixture = await loadExample('Coffee Order (basic)', Version.V0_8);
    textContent = getCanvas().textContent;
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Subtotal');
    expect(textContent).toContain('Tax');
    expect(textContent).toContain('Total');
    expect(textContent).toContain('Purchase');
    expect(textContent).toContain('Add to cart');
    expect(textContent).toContain('Sunrise Coffee');
    expect(textContent).toContain('Oat Milk Latte');
    expect(textContent).toContain('Grande, Extra Shot');
    expect(textContent).toContain('$6.45');
    expect(textContent).toContain('Chocolate Croissant');
    expect(textContent).toContain('Warmed');
    expect(textContent).toContain('$4.25');
    expect(textContent).toContain('$10.70');
    expect(textContent).toContain('$0.96');
    expect(textContent).toContain('$11.66');
  });

  it('should dispatch purchase action on button click', async () => {
    const component = fixture.componentInstance;

    const buttons = fixture.nativeElement.querySelectorAll('a2ui-button button');
    expect(buttons.length).toBeGreaterThan(0);
    const btn = buttons[0];
    expect(btn).toBeTruthy();

    btn.click();
    fixture.detectChanges();

    await wait(10);

    expect(component.eventsLog.length).toBeGreaterThan(0);
    const loggedAction = component.eventsLog[0].action;
    expect(loggedAction.name).toBe('purchase');
  });

  it('should dispatch add_to_cart action on button click', async () => {
    const component = fixture.componentInstance;

    const buttons = fixture.nativeElement.querySelectorAll('a2ui-button button');
    expect(buttons.length).toBeGreaterThan(1);
    const btn = buttons[1];
    expect(btn).toBeTruthy();

    btn.click();
    fixture.detectChanges();

    await wait(10);

    expect(component.eventsLog.length).toBeGreaterThan(0);
    const loggedAction = component.eventsLog[0].action;
    expect(loggedAction.name).toBe('add_to_cart');
  });
});
