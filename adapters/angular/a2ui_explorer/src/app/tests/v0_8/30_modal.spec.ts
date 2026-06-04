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

describe('Example: Modal Sample (basic) (v0.8)', () => {
  let textContent: string;
  let fixture: ComponentFixture<DemoComponent>;

  beforeEach(async () => {
    fixture = await loadExample('Modal Sample (basic)', Version.V0_8);
    textContent = getCanvas().textContent;
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Modal Component Sample');
    expect(textContent).toContain('Open Modal');
  });

  it('should open modal and check overlay position', async () => {
    // Click button to open modal
    const buttons = fixture.nativeElement.querySelectorAll('a2ui-button button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons[0].click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    textContent = getCanvas().textContent;
    expect(textContent).toContain('This is the content inside the modal.');

    // Check overlay position
    const overlay = fixture.nativeElement.querySelector('.a2ui-modal-overlay');
    expect(overlay).toBeTruthy();
    const style = window.getComputedStyle(overlay);
    expect(style.position).toBe('fixed');
  });

  it('should dispatch openModalEvent action on button click', async () => {
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
    expect(loggedAction.name).toBe('openModalEvent');
  });
});
