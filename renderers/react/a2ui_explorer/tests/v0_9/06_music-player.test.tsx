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

import {loadExample, cleanup, getSurface} from '../utils/test-utils';
describe('Example: Music Player', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('06_music-player.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Blinding Lights');
    expect(textContent).toContain('The Weeknd');
    expect(textContent).toContain('1:48');
    expect(textContent).toContain('4:22');
  });

  it('should render image', async () => {
    const img = Array.from(surface.querySelectorAll('img'))[0] as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop',
    );
  });

  it('should render icons', async () => {
    expect(textContent).toContain('skip_previous');
    expect(textContent).toContain('skip_next');
    expect(textContent).toContain('pause');
  });
});
