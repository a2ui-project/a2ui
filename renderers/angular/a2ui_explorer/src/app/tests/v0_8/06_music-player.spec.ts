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

describe('Example: Music Player (basic) (v0.8)', () => {
  let textContent: string;
  let fixture: ComponentFixture<DemoComponent>;

  beforeEach(async () => {
    fixture = await loadExample('Music Player (basic)', Version.V0_8);
    textContent = getCanvas().textContent;
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Blinding Lights');
    expect(textContent).toContain('The Weeknd');
    expect(textContent).toContain('1:48');
    expect(textContent).toContain('4:22');
    expect(textContent).toContain('pause');
  });

  it('should dispatch previous action on button click', async () => {
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
    expect(loggedAction.name).toBe('previous');
  });

  it('should dispatch playPause action on button click', async () => {
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
    expect(loggedAction.name).toBe('playPause');
  });

  it('should dispatch next action on button click', async () => {
    const component = fixture.componentInstance;

    const buttons = fixture.nativeElement.querySelectorAll('a2ui-button button');
    expect(buttons.length).toBeGreaterThan(2);
    const btn = buttons[2];
    expect(btn).toBeTruthy();

    btn.click();
    fixture.detectChanges();

    await wait(10);

    expect(component.eventsLog.length).toBeGreaterThan(0);
    const loggedAction = component.eventsLog[0].action;
    expect(loggedAction.name).toBe('next');
  });
});
