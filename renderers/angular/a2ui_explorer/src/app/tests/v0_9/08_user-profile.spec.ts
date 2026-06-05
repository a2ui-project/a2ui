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

describe('Example: User Profile', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('User Profile');
    textContent = getCanvas().textContent;
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Sarah Chen');
    expect(textContent).toContain('@sarahchen');
    expect(textContent).toContain('Product Designer at Tech Co. Creating delightful experiences.');
    expect(textContent).toContain('Followers');
    expect(textContent).toContain('Following');
    expect(textContent).toContain('Posts');
    expect(textContent).toContain('Follow');
  });

  it('should render formatted numbers', async () => {
    expect(textContent).toContain('892');
    expect(textContent).toContain('347');
  });

  it('should render image', async () => {
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop',
    );
  });
});
