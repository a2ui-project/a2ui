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
  loadExample,
  getSurface,
  getDeepTextContent,
  querySelectorAllDeep,
  whenSettled,
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Native Lit Grid', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  beforeEach(async () => {
    gallery = await loadExample('37_native-grid.json');
    surface = getSurface(gallery);
  });

  afterEach(() => {
    gallery?.remove();
  });

  it('should render the native container component and header content', () => {
    const textContent = getDeepTextContent(surface);
    expect(textContent).toContain('Native Container Component Showcase');
    expect(textContent).toContain('Interactive 2x2 Component Grid');
    expect(querySelectorAllDeep(surface, 'a2ui-custom-grid').length).toBeGreaterThan(0);
  });

  it('should instantiate custom component children (CustomSlider)', () => {
    const textContent = getDeepTextContent(surface);
    expect(textContent).toContain('Master Volume (Native)');
    expect(textContent).toContain('Brightness Level (Native)');

    const customSliders = querySelectorAllDeep(surface, 'a2ui-custom-slider');
    expect(customSliders.length).toBe(2);
  });

  it('should instantiate universal web component children (Card, Text, Button)', () => {
    const textContent = getDeepTextContent(surface);
    expect(textContent).toContain('Universal Web Component: Text & Card');
    expect(textContent).toContain('Universal Button Action');

    expect(querySelectorAllDeep(surface, 'a2ui-card, a2ui-basic-card').length).toBeGreaterThan(0);
    expect(querySelectorAllDeep(surface, 'a2ui-button, a2ui-basic-button').length).toBeGreaterThan(
      0,
    );
  });

  it('should update reactive data binding across native and universal components', async () => {
    const slider = querySelectorAllDeep(
      surface,
      'a2ui-custom-slider input[type="range"]',
    )[0] as HTMLInputElement;
    expect(slider).toBeTruthy();

    slider.value = '80';
    slider.dispatchEvent(new Event('input'));
    await whenSettled(gallery);

    const textContent = getDeepTextContent(surface);
    expect(textContent).toContain('Vol: 80% | Bright: 30%');
  });
});
