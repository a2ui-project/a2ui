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

describe('Example: Software Purchase (basic) (v0.8)', () => {
  let textContent: string;
  let fixture: ComponentFixture<DemoComponent>;

  beforeEach(async () => {
    fixture = await loadExample('Software Purchase (basic)', Version.V0_8);
    textContent = getCanvas().textContent;
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Purchase License');
    expect(textContent).toContain('Number of seats');
    expect(textContent).toContain('Billing period');
    expect(textContent).toContain('Total');
    expect(textContent).toContain('Confirm Purchase');
    expect(textContent).toContain('Cancel');
    expect(textContent).toContain('Design Suite Pro');
    expect(textContent).toContain('10 seats');
    expect(textContent).toContain('Annual');
    expect(textContent).toContain('$1,188/year');
  });

  it('should dispatch confirm action on button click', async () => {
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
    expect(loggedAction.name).toBe('confirm');
  });

  it('should dispatch cancel action on button click', async () => {
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
    expect(loggedAction.name).toBe('cancel');
  });
});
