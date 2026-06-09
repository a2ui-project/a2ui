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

describe('Example: Movie Card', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('29_movie-card.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
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
    const img = querySelectorAllDeep(surface, 'img')[0] as HTMLImageElement;
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
    const button = querySelectorAllDeep(surface, '.a2ui-modal-trigger')[0] as HTMLElement;
    expect(button).withContext('Should find trigger button').toBeTruthy();

    button.click();
    await whenSettled(gallery);

    const modal = querySelectorAllDeep(surface, '.a2ui-modal-overlay')[0] as HTMLDialogElement;
    expect(modal?.open).toBeTruthy();

    const video = querySelectorAllDeep(surface, 'video')[0] as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video!.getAttribute('src')).toBe('https://www.w3schools.com/html/mov_bbb.mp4');

    // Cleanup: close modal by clicking close button
    const closeBtn = querySelectorAllDeep(surface, '.a2ui-modal-close')[0] as HTMLElement;
    closeBtn.click();
    await whenSettled(gallery);
  });
});
