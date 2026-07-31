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

describe('Example: Contact Card', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let component: DemoComponent;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Contact Card');
    component = fixture.componentInstance;
    textContent = getCanvas().textContent;
  });

  it('should render text content', async () => {
    expect(textContent).toContain('David Park');
    expect(textContent).toContain('Engineering Manager');
    expect(textContent).toContain('+1 (555) 234-5678');
    expect(textContent).toContain('david.park@company.com');
    expect(textContent).toContain('San Francisco, CA');
    expect(textContent).toContain('Call');
    expect(textContent).toContain('Message');
  });

  it('should render image', async () => {
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
    );
  });

  it('should render icons', async () => {
    const icons = fixture.nativeElement.querySelectorAll('.a2ui-icon');
    expect(icons.length).toBeGreaterThanOrEqual(3);

    expect(textContent).toContain('location_on');
    expect(textContent).toContain('phone');
    expect(textContent).toContain('mail');
  });

  it('should handle Call button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const callBtn = buttons.find(b => b.textContent.includes('Call'))!;
    expect(callBtn).withContext('Should find Call button').toBeTruthy();

    callBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('call');
  });

  it('should handle Message button click', async () => {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.a2ui-button'),
    ] as HTMLButtonElement[];
    const messageBtn = buttons.find(b => b.textContent.includes('Message'))!;
    expect(messageBtn).withContext('Should find Message button').toBeTruthy();

    messageBtn.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('message');
  });
});
