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
describe('Example: Sports Player', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('14_sports-player.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Marcus Johnson');
    expect(textContent).toContain('#23');
    expect(textContent).toContain('LA Lakers');
    expect(textContent).toContain('28.4');
    expect(textContent).toContain('PPG');
    expect(textContent).toContain('7.2');
    expect(textContent).toContain('RPG');
    expect(textContent).toContain('6.8');
    expect(textContent).toContain('APG');
  });

  it('should render image', async () => {
    const img = Array.from(surface.querySelectorAll('img'))[0] as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=200&h=200&fit=crop',
    );
  });
});
