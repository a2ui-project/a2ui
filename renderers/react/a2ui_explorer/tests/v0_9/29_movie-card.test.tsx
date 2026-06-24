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

import {act} from 'react';
import {loadExample, cleanup, getSurface, whenSettled} from '../utils/test-utils';
describe('Example: Movie Card', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('29_movie-card.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Interstellar');
    expect(textContent).toContain('(2014)');
    expect(textContent).toContain('Sci-Fi • Adventure • Drama');
    expect(textContent).toContain('8.7/10');
    expect(textContent).toContain('2h 49min');
    expect(textContent).toContain('Watch Trailer');
  });

  it('should render image', async () => {
    const img = Array.from(surface.querySelectorAll('img'))[0] as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=200&h=300&fit=crop',
    );
  });

  it('should render icons', async () => {
    expect(textContent).toContain('calendar_today');
    expect(textContent).toContain('star');
  });

  it('should open modal with video when clicking watch trailer button', async () => {
    const button = Array.from(surface.querySelectorAll('.a2ui-modal-trigger'))[0] as HTMLElement;
    expect(button).withContext('Should find trigger button').toBeTruthy();

    await act(async () => {
      button.click();
      await whenSettled();
    });

    const modal = Array.from(surface.querySelectorAll('.a2ui-modal-overlay'))[0] as HTMLElement;
    expect(modal).toBeTruthy();

    const video = Array.from(surface.querySelectorAll('video'))[0] as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toBe('https://www.w3schools.com/html/mov_bbb.mp4');

    // Cleanup: close modal by clicking close button
    const closeBtn = Array.from(surface.querySelectorAll('.a2ui-modal-close'))[0] as HTMLElement;
    await act(async () => {
      closeBtn.click();
      await whenSettled();
    });
  });
});
