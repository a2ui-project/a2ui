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

describe('Example: ChildList Template Expansion', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('34_child-list-template.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render title', async () => {
    expect(textContent).toContain('Dynamic Item List');
  });

  it('should render list items', async () => {
    expect(textContent).toContain('Apple');
    expect(textContent).toContain('10');
    expect(textContent).toContain('Banana');
    expect(textContent).toContain('5');
    expect(textContent).toContain('Cherry');
    expect(textContent).toContain('20');
  });

  it('should render label', async () => {
    expect(textContent).toContain('Qty');
  });
});
