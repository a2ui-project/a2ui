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

describe('Example: Account Balance', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let component: DemoComponent;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Account Balance');
    component = fixture.componentInstance;
    textContent = getCanvas().textContent;
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Primary Checking');
    expect(textContent).toContain('Updated just now');
    expect(textContent).toContain('Transfer');
    expect(textContent).toContain('Pay Bill');

    // Check for formatted currency (best effort)
    expect(textContent).toContain('12,458.32');
  });

  it('should render icon', async () => {
    expect(fixture.nativeElement.querySelector('.a2ui-icon')).toBeTruthy();
    expect(textContent).toContain('payment');
  });

  it('should handle Transfer button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const transferBtn = buttons.find(b => b.textContent.includes('Transfer'))!;
    expect(transferBtn).withContext('Should find Transfer button').toBeTruthy();

    transferBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('transfer');
  });

  it('should handle Pay Bill button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const payBtn = buttons.find(b => b.textContent.includes('Pay Bill'))!;
    expect(payBtn).withContext('Should find Pay Bill button').toBeTruthy();

    payBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('pay_bill');
  });
});
