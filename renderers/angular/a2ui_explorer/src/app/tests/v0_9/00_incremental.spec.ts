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

describe('Example: Incremental', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Incremental');
    textContent = getCanvas().textContent || '';
  });

  it('should render expected restaurants', async () => {
    expect(textContent).toContain('The Golden Fork');
    expect(textContent).toContain("Ocean's Bounty");
    expect(textContent).toContain('Pizzeria Roma');
    expect(textContent).toContain('Spice Route');
  });

  it('should render Book now button for each restaurant', async () => {
    const buttons = fixture.nativeElement.querySelectorAll(
      '.a2ui-button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBe(4);
    expect(buttons[0].textContent).toContain('Book now');
  });

  it('should dispatch book_now action when a Book now button is clicked', async () => {
    const component = fixture.componentInstance;
    const buttons = fixture.nativeElement.querySelectorAll(
      '.a2ui-button',
    ) as NodeListOf<HTMLButtonElement>;

    // Click the Book now button for "The Golden Fork" (first restaurant)
    buttons[0].click();
    fixture.detectChanges();
    await wait(10);

    expect(component.eventsLog.length).toBeGreaterThan(0);
    const loggedAction = component.eventsLog[0].action;
    expect(loggedAction.name).toBe('book_now');
    expect(loggedAction.context).toEqual({
      restaurantName: 'The Golden Fork',
    });
  });
});
