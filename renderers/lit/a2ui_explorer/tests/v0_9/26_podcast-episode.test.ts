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
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Podcast Episode', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('26_podcast-episode.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Tech Talk Daily');
    expect(textContent).toContain('The Future of AI in Product Design');
    expect(textContent).toContain('45 min');
    expect(textContent).toContain('2024');
    expect(textContent).toContain('How AI is transforming the way we design and build products.');
  });

  it('should render image', async () => {
    const img = querySelectorAllDeep(surface, 'img')[0] as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=100&h=100&fit=crop',
    );
  });

  it('should render audio player', async () => {
    const audio = querySelectorAllDeep(surface, 'audio')[0] as HTMLAudioElement;
    expect(audio).toBeTruthy();
    expect(audio.getAttribute('src')).toBe(
      'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    );
  });
});
