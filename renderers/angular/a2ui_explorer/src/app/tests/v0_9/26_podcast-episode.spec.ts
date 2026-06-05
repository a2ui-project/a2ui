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
import {getCanvas, loadExample} from '../utils';

describe('Example: Podcast Episode', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Podcast Episode');
    textContent = getCanvas().textContent;
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Tech Talk Daily');
    expect(textContent).toContain('The Future of AI in Product Design');
    expect(textContent).toContain('45 min');
    expect(textContent).toContain('2024');
    expect(textContent).toContain('How AI is transforming the way we design and build products.');
  });

  it('should render image', async () => {
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=100&h=100&fit=crop',
    );
  });

  it('should render audio player', async () => {
    const audio = fixture.nativeElement.querySelector('audio');
    expect(audio).toBeTruthy();
    expect(audio.getAttribute('src')).toBe(
      'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    );
  });
});
