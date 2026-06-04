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

describe('Example: Event Detail', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let component: DemoComponent;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Event Detail');
    component = fixture.componentInstance;
    textContent = getCanvas().textContent;
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Product Launch Meeting');

    // Check for location
    expect(textContent).toContain('Conference Room A, Building 2');

    // Check for description
    expect(textContent).toContain(
      'Review final product specs and marketing materials before the Q1 launch.',
    );

    // Check for buttons
    expect(textContent).toContain('Accept');
    expect(textContent).toContain('Decline');

    // Check for date/time (approximate or specific if we trust UTC)
    expect(textContent).toContain('Dec 19');
  });

  it('should render icons', async () => {
    const icons = fixture.nativeElement.querySelectorAll('.a2ui-icon');
    expect(icons.length).toBeGreaterThanOrEqual(2);

    expect(textContent).toContain('calendar_today');
    expect(textContent).toContain('location_on');
  });

  it('should handle Accept button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const acceptBtn = buttons.find(b => b.textContent.includes('Accept'))!;
    expect(acceptBtn).withContext('Should find Accept button').toBeTruthy();

    acceptBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('accept');
  });

  it('should handle Decline button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const declineBtn = buttons.find(b => b.textContent.includes('Decline'))!;
    expect(declineBtn).withContext('Should find Decline button').toBeTruthy();

    declineBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('decline');
  });
});
