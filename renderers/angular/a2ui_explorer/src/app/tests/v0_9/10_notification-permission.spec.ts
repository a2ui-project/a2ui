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

describe('Example: Notification Permission', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let component: DemoComponent;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Notification Permission');
    component = fixture.componentInstance;
    textContent = getCanvas().textContent;
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Enable notification');

    // Check for description
    expect(textContent).toContain('Get alerts for order status changes');

    // Check for buttons
    expect(textContent).toContain('Yes');
    expect(textContent).toContain('No');
  });

  it('should render icon', async () => {
    const iconEl = fixture.nativeElement.querySelector('.a2ui-icon');
    expect(iconEl).toBeTruthy();
    expect(textContent).toContain('check');
  });

  it('should handle Yes button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const yesBtn = buttons.find(b => b.textContent.includes('Yes'))!;
    expect(yesBtn).withContext('Should find Yes button').toBeTruthy();

    yesBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('accept');
  });

  it('should handle No button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const noBtn = buttons.find(b => b.textContent.includes('No'))!;
    expect(noBtn).withContext('Should find No button').toBeTruthy();

    noBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('decline');
  });
});
