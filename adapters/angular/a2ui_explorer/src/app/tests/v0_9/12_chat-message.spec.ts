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

describe('Example: Chat Message', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Chat Message');
    textContent = getCanvas().textContent;
  });

  it('should render channel name', async () => {
    expect(textContent).toContain('project-updates');
  });

  it('should render messages content', async () => {
    expect(textContent).toContain('Mike Chen');
    expect(textContent).toContain('Just pushed the new API changes. Ready for review.');

    expect(textContent).toContain('Sarah Kim');
    expect(textContent).toContain("Great! I'll take a look after standup.");
  });

  it('should render images', async () => {
    const imgs = fixture.nativeElement.querySelectorAll('img');
    expect(imgs.length).toBeGreaterThanOrEqual(2);

    const srcs = ([...imgs] as HTMLImageElement[]).map(img => img.getAttribute('src'));
    expect(srcs).toContain(
      'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=40&h=40&fit=crop',
    );
    expect(srcs).toContain(
      'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=40&h=40&fit=crop',
    );
  });
});
