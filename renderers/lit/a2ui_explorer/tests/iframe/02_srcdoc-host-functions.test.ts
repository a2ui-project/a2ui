/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  getDeepTextContent,
  getSurface,
  loadExample,
  querySelectorAllDeep,
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Srcdoc Host Functions', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  beforeEach(async () => {
    gallery = await loadExample('iframe/02_srcdoc-host-functions.json');
    surface = getSurface(gallery);
  });

  afterEach(() => {
    gallery?.remove();
  });

  it('should render the sibling basic components', () => {
    const textContent = getDeepTextContent(surface);
    expect(textContent).toContain('Cart total');
    expect(textContent).toContain('Raw total: 1234.5 EUR');
  });

  it('should load the sandbox proxy for inline content from the explorer origin', () => {
    const frames = querySelectorAllDeep(surface, 'iframe') as HTMLIFrameElement[];
    expect(frames.length).toBe(1);
    const url = new URL(frames[0].src);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/a2ui-sandbox/sandbox.html');
  });

  it('should apply the height property to the frame element', () => {
    const element = querySelectorAllDeep(surface, 'a2ui-web-app-frame-srcdoc')[0] as HTMLElement;
    expect(element.style.height).toBe('120px');
  });
});
