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

describe('Example: Email Compose', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let component: DemoComponent;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Email Compose');
    component = fixture.componentInstance;
    textContent = getCanvas().textContent;
  });

  it('should render text content', async () => {
    expect(textContent).toContain('FROM');
    expect(textContent).toContain('TO');
    expect(textContent).toContain('SUBJECT');
    expect(textContent).toContain('Send email');
    expect(textContent).toContain('Discard');
    expect(textContent).toContain('alex@acme.com');
    expect(textContent).toContain('jordan@acme.com');
    expect(textContent).toContain('Q4 Revenue Forecast');
    expect(textContent).toContain('Hi Jordan,');
    expect(textContent).toContain(
      'Following up on our call. Please review the attached Q4 forecast and let me know if you have questions before the board meeting.',
    );
    expect(textContent).toContain('Best,');
    expect(textContent).toContain('Alex');
  });

  it('should handle Send button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const sendBtn = buttons.find(b => b.textContent.includes('Send'))!;
    expect(sendBtn).withContext('Should find Send button').toBeTruthy();

    sendBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('send');
  });

  it('should handle Discard button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const discardBtn = buttons.find(b => b.textContent.includes('Discard'))!;
    expect(discardBtn).withContext('Should find Discard button').toBeTruthy();

    discardBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('discard');
  });
});
