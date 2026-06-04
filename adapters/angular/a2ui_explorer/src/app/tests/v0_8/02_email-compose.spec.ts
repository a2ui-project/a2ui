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

describe('Example: Email Compose (v0.8)', () => {
  let textContent: string;
  let fixture: ComponentFixture<DemoComponent>;

  beforeEach(async () => {
    fixture = await loadExample('Email Compose', Version.V0_8);
    textContent = getCanvas().textContent;
  });

  it('should render email headers', async () => {
    expect(textContent).toContain('FROM');
    expect(textContent).toContain('alex@acme.com');
    expect(textContent).toContain('TO');
    expect(textContent).toContain('jordan@acme.com');
    expect(textContent).toContain('SUBJECT');
    expect(textContent).toContain('Q4 Revenue Forecast');
  });

  it('should render email body', async () => {
    expect(textContent).toContain('Hi Jordan,');
    expect(textContent).toContain('Following up on our call');
    expect(textContent).toContain('Best,');
    expect(textContent).toContain('Alex');
  });

  it('should render buttons', async () => {
    expect(textContent).toContain('Send email');
    expect(textContent).toContain('Discard');
  });

  it('should dispatch send action on button click', async () => {
    const component = fixture.componentInstance;

    const sendBtn = fixture.nativeElement.querySelector('a2ui-button button');
    expect(sendBtn).toBeTruthy();

    sendBtn.click();
    fixture.detectChanges();

    await wait(10);

    expect(component.eventsLog.length).toBeGreaterThan(0);
    const loggedAction = component.eventsLog[0].action;
    expect(loggedAction.name).toBe('send');
  });

  it('should dispatch discard action on button click', async () => {
    const component = fixture.componentInstance;

    const buttons = fixture.nativeElement.querySelectorAll('a2ui-button button');
    expect(buttons.length).toBeGreaterThan(1);
    const discardBtn = buttons[1];
    expect(discardBtn).toBeTruthy();

    discardBtn.click();
    fixture.detectChanges();

    await wait(10);

    expect(component.eventsLog.length).toBeGreaterThan(0);
    const loggedAction = component.eventsLog[0].action;
    expect(loggedAction.name).toBe('discard');
  });
});
