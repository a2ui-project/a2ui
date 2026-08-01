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

import {loadExample, getSurface, getDeepTextContent} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Live Calculator', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('37_live-calculator.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Bill Splitter');
    expect(textContent).toContain('Subtotal');
    expect(textContent).toContain('Tip per person');
    expect(textContent).toContain('Total');
  });

  it('should render values computed from the data model', async () => {
    // Currency symbols are locale-dependent; the amounts are not.
    expect(textContent).toContain('40.00');
    expect(textContent).toContain('8.00');
    expect(textContent).toContain('4.00');
    expect(textContent).toContain('48.00');
  });

  it('should interpolate function calls inside a formatted string', async () => {
    expect(textContent).toContain('20% tip');
    expect(textContent).toContain('Splitting the tip 2 ways');
  });
});
