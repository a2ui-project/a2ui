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

describe('Example: Track List', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('18_track-list.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render playlist name', async () => {
    expect(textContent).toContain('Focus Flow');
  });

  it('should render Weightless track details', async () => {
    expect(textContent).toContain('Weightless');
    expect(textContent).toContain('Marconi Union');
    expect(textContent).toContain('8:09');
  });

  it('should render Clair de Lune track details', async () => {
    expect(textContent).toContain('Clair de Lune');
    expect(textContent).toContain('Debussy');
    expect(textContent).toContain('5:12');
  });

  it('should render Ambient Light track details', async () => {
    expect(textContent).toContain('Ambient Light');
    expect(textContent).toContain('Brian Eno');
    expect(textContent).toContain('6:45');
  });

  it('should render images', async () => {
    const imgs = querySelectorAllDeep(surface, 'img');
    expect(imgs.length).toBeGreaterThanOrEqual(3);

    const srcs = ([...imgs] as HTMLImageElement[]).map(img => img.getAttribute('src'));
    expect(srcs).toContain(
      'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=50&h=50&fit=crop',
    );
    expect(srcs).toContain(
      'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=50&h=50&fit=crop',
    );
    expect(srcs).toContain(
      'https://images.unsplash.com/photo-1507838153414-b4b713384a76?w=50&h=50&fit=crop',
    );
  });
});
