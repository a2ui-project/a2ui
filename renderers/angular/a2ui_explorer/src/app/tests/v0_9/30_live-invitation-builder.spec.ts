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
import {getCanvas, loadExample, wait, waitForCondition} from '../utils';

describe('Example: Live Invitation Builder', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Live Invitation Builder');
    textContent = getCanvas().textContent;
  });

  function getLivePreview() {
    const allElements = [...fixture.nativeElement.querySelectorAll('*')] as HTMLElement[];
    const celebratingEl = allElements.find(el => el.textContent.trim() === 'Celebrating')!;
    const livePreview = celebratingEl.parentElement!.parentElement!.parentElement!;
    expect(livePreview).withContext('Should Live Preview card content wrapper').toBeTruthy();
    return livePreview;
  }

  it('should render text content', async () => {
    // Wait for async rendering to complete
    await wait(100);
    fixture.detectChanges();
    textContent = getCanvas().textContent;

    expect(textContent).toContain('Invitation Builder');
    expect(textContent).toContain('Customize your invitation');
    expect(textContent).toContain('Live Preview');

    const livePreview = getLivePreview();

    expect(livePreview.textContent).toContain('Celebrating');
    expect(livePreview.textContent).toContain('Location:');
  });

  it('should render date', async () => {
    expect(textContent).toContain('July 15');
    expect(textContent).toContain('2025');
  });

  it('should render image', async () => {
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=400&h=200&fit=crop',
    );
  });

  it('should render inputs', async () => {
    const inputs = [...fixture.nativeElement.querySelectorAll('input')] as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('should update preview when changing Event Name input', async () => {
    const inputs = [...fixture.nativeElement.querySelectorAll('input')] as HTMLInputElement[];
    const textInputs = inputs.filter(i => i.type === 'text' || !i.type);
    expect(textInputs.length).toBeGreaterThanOrEqual(2);

    const nameInput = textInputs[0];
    nameInput.value = 'Awesome Party';
    nameInput.dispatchEvent(new Event('input'));

    const guestInput = textInputs[1];
    guestInput.value = 'Alex Johnson';
    guestInput.dispatchEvent(new Event('input'));

    fixture.detectChanges();
    await wait(10);
    fixture.detectChanges();

    const livePreview = getLivePreview();

    expect(livePreview.textContent).toContain('Awesome Party');
  });

  it('should update preview when changing Guest of Honor input', async () => {
    const inputs = [...fixture.nativeElement.querySelectorAll('input')] as HTMLInputElement[];
    const textInputs = inputs.filter(i => i.type === 'text' || !i.type);
    expect(textInputs.length).toBeGreaterThanOrEqual(2);

    const nameInput = textInputs[0];
    nameInput.value = 'Summer Gala';
    nameInput.dispatchEvent(new Event('input'));

    const guestInput = textInputs[1];
    guestInput.value = 'John Doe';
    guestInput.dispatchEvent(new Event('input'));

    fixture.detectChanges();
    await wait(10);
    fixture.detectChanges();

    const livePreview = getLivePreview();

    expect(livePreview.textContent).toContain('John Doe');
  });

  it('should update preview when changing location', async () => {
    await wait(100);
    fixture.detectChanges();

    const chips = [...fixture.nativeElement.querySelectorAll('.a2ui-chip')] as HTMLElement[];
    expect(chips.length).toBeGreaterThanOrEqual(3);

    const ballroomChip = chips.find(el => el.textContent.trim() === 'Grand Ballroom');
    expect(ballroomChip).toBeTruthy();

    ballroomChip!.click();
    fixture.detectChanges();

    // Wait for the async template rendering to propagate to the DOM
    const ballroomUpdated = await waitForCondition(() => {
      fixture.detectChanges();
      return getLivePreview().textContent.includes('Location: ballroom');
    });
    expect(ballroomUpdated).withContext('Location should update to ballroom').toBeTrue();

    const terraceChip = chips.find(el => el.textContent.trim() === 'Sunset Terrace');
    expect(terraceChip).toBeTruthy();

    terraceChip!.click();
    fixture.detectChanges();

    const terraceUpdated = await waitForCondition(() => {
      fixture.detectChanges();
      return getLivePreview().textContent.includes('Location: terrace');
    });
    expect(terraceUpdated).withContext('Location should update back to terrace').toBeTrue();
  });
});
