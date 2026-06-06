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

describe('Example: Credit Card', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('22_credit-card.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render text content', async () => {
    expect(textContent).toContain('CARD HOLDER');
    expect(textContent).toContain('EXPIRES');
    expect(textContent).toContain('VISA');
    expect(textContent).toContain('•••• •••• •••• 4242');
    expect(textContent).toContain('SARAH JOHNSON');
    expect(textContent).toContain('09/27');
  });

  it('should render icon', async () => {
    expect(querySelectorAllDeep(surface, 'a2ui-icon')[0] as HTMLElement).toBeTruthy();
    expect(textContent).toContain('payment');
  });
});
