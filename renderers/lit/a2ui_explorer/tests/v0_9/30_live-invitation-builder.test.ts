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

import {
  loadExample,
  getSurface,
  getDeepTextContent,
  querySelectorAllDeep,
  whenSettled,
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForCondition(
  condition: () => boolean,
  timeout = 1000,
  interval = 50,
): Promise<boolean> {
  const start = performance.now();
  while (true) {
    if (condition()) {
      return true;
    }
    if (performance.now() - start > timeout) {
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

describe('Example: Live Invitation Builder', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('30_live-invitation-builder.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  function getLivePreview() {
    const cards = querySelectorAllDeep(surface, 'a2ui-card');
    const livePreview = cards[0];
    expect(livePreview).withContext('Should Live Preview card content wrapper').toBeTruthy();
    return livePreview as HTMLElement;
  }

  it('should render text content', async () => {
    // Wait for async rendering to complete
    await wait(100);
    await whenSettled(gallery);
    textContent = getDeepTextContent(surface);

    expect(textContent).toContain('Invitation Builder');
    expect(textContent).toContain('Customize your invitation');
    expect(textContent).toContain('Live Preview');

    const livePreview = getLivePreview();

    expect(getDeepTextContent(livePreview)).toContain('Celebrating');
    expect(getDeepTextContent(livePreview)).toContain('Location:');
  });

  it('should render date', async () => {
    expect(textContent).toContain('July 15');
    expect(textContent).toContain('2025');
  });

  it('should render image', async () => {
    const img = querySelectorAllDeep(surface, 'img')[0] as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=400&h=200&fit=crop',
    );
  });

  it('should render inputs', async () => {
    const inputs = querySelectorAllDeep(surface, 'input') as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('should update preview when changing Event Name input', async () => {
    const inputs = querySelectorAllDeep(surface, 'input') as HTMLInputElement[];
    const textInputs = inputs.filter(i => i.type === 'text' || !i.type);
    expect(textInputs.length).toBeGreaterThanOrEqual(2);

    const nameInput = textInputs[0];
    expect(nameInput.value).withContext('nameInput initial value').toBe('Summer Gala');
    const guestInput = textInputs[1];
    expect(guestInput.value).withContext('guestInput initial value').toBe('Alex Johnson');

    nameInput.value = 'Awesome Party';
    nameInput.dispatchEvent(new Event('input'));

    guestInput.value = 'Alex Johnson';
    guestInput.dispatchEvent(new Event('input'));

    await whenSettled(gallery);

    const livePreview = getLivePreview();

    expect(getDeepTextContent(livePreview)).toContain('Awesome Party');
  });

  it('should update preview when changing Guest of Honor input', async () => {
    const inputs = querySelectorAllDeep(surface, 'input') as HTMLInputElement[];
    const textInputs = inputs.filter(i => i.type === 'text' || !i.type);
    expect(textInputs.length).toBeGreaterThanOrEqual(2);

    const nameInput = textInputs[0];
    expect(nameInput.value).withContext('nameInput initial value 2').toBe('Summer Gala');
    const guestInput = textInputs[1];
    expect(guestInput.value).withContext('guestInput initial value 2').toBe('Alex Johnson');

    nameInput.value = 'Summer Gala';
    nameInput.dispatchEvent(new Event('input'));

    guestInput.value = 'John Doe';
    guestInput.dispatchEvent(new Event('input'));

    await whenSettled(gallery);

    const livePreview = getLivePreview();

    expect(getDeepTextContent(livePreview)).toContain('John Doe');
  });

  it('should update preview when changing location', async () => {
    await wait(100);
    await whenSettled(gallery);

    const chips = querySelectorAllDeep(surface, '.chip') as HTMLElement[];
    expect(chips.length).toBeGreaterThanOrEqual(3);

    const ballroomChip = chips.find(el => el.textContent.trim() === 'Grand Ballroom');
    expect(ballroomChip).toBeTruthy();

    ballroomChip!.click();
    await whenSettled(gallery);

    // Wait for the async template rendering to propagate to the DOM
    const ballroomUpdated = await waitForCondition(() => {
      return getDeepTextContent(getLivePreview()).includes('Location: ballroom');
    });
    expect(ballroomUpdated).withContext('Location should update to ballroom').toBeTrue();

    const terraceChip = chips.find(el => el.textContent.trim() === 'Sunset Terrace');
    expect(terraceChip).toBeTruthy();

    terraceChip!.click();
    await whenSettled(gallery);

    const terraceUpdated = await waitForCondition(() => {
      return getDeepTextContent(getLivePreview()).includes('Location: terrace');
    });
    expect(terraceUpdated).withContext('Location should update back to terrace').toBeTrue();
  });
});
