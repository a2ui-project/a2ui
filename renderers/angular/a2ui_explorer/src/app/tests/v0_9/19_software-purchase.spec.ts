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

describe('Example: Software Purchase', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let component: DemoComponent;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Software Purchase');
    component = fixture.componentInstance;
    textContent = getCanvas().textContent;
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Purchase License');
    expect(textContent).toContain('Design Suite Pro');
    expect(textContent).toContain('Number of seats');
    expect(textContent).toContain('10 seats');
    expect(textContent).toContain('Billing period');
    expect(textContent).toContain('Annual');
    expect(textContent).toContain('Monthly');
    expect(textContent).toContain('Total');
    expect(textContent).toContain('Confirm Purchase');
    expect(textContent).toContain('Cancel');
  });

  it('should render formatted currency', async () => {
    expect(textContent).toContain('1,188');
  });

  it('should handle Confirm Purchase button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const confirmBtn = buttons.find(b => b.textContent.includes('Confirm Purchase'))!;
    expect(confirmBtn).withContext('Should find Confirm Purchase button').toBeTruthy();

    confirmBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('confirm');
  });

  it('should handle Cancel button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const cancelBtn = buttons.find(b => b.textContent.includes('Cancel'))!;
    expect(cancelBtn).withContext('Should find Cancel button').toBeTruthy();

    cancelBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('cancel');
  });
});
