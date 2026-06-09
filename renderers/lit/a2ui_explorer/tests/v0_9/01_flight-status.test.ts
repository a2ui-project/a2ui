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

describe('Example: Flight Status', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('01_flight-status.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render flight details', async () => {
    expect(textContent).toContain('OS 87');
    expect(textContent).toContain('Vienna');
    expect(textContent).toContain('→');
    expect(textContent).toContain('New York');
  });

  it('should render labels', async () => {
    expect(textContent).toContain('Departs');
    expect(textContent).toContain('Arrives');
    expect(textContent).toContain('Status');
    expect(textContent).toContain('On Time');
  });

  it('should render icon', async () => {
    const iconInnerEl = querySelectorAllDeep(surface, 'a2ui-icon')[0] as HTMLElement;
    expect(iconInnerEl).toBeTruthy();
    expect(getDeepTextContent(iconInnerEl).trim()).toBe('send');
  });
});
