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
import {Version, getCanvas, loadExample} from '../utils/test_utils';

describe('Example: Restaurant Card (basic) (v0.8)', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Restaurant Card (basic)', Version.V0_8);
    textContent = getCanvas().textContent;
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('The Italian Kitchen');
    expect(textContent).toContain('$$$');
    expect(textContent).toContain('Italian • Pasta • Wine Bar');
    expect(textContent).toContain('4.8');
    expect(textContent).toContain('(2,847 reviews)');
    expect(textContent).toContain('0.8 mi');
    expect(textContent).toContain('25-35 min');
  });

  it('should render image', async () => {
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=300&h=150&fit=crop',
    );
  });

  it('should render icon', async () => {
    const icon = fixture.nativeElement.querySelector('a2ui-icon');
    expect(icon).toBeTruthy();
    expect(icon.textContent).toBe('star');
  });
});
