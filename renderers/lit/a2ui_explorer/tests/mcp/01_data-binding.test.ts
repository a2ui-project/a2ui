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
  waitFor,
  whenSettled,
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Data Binding', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;
  let frame: HTMLIFrameElement;

  beforeEach(async () => {
    gallery = await loadExample('mcp/01_data-binding.json');
    surface = getSurface(gallery);
    frame = querySelectorAllDeep(surface, 'iframe')[0] as HTMLIFrameElement;
  });

  afterEach(() => {
    gallery?.remove();
  });

  it('should render the sibling basic components', () => {
    const textContent = getDeepTextContent(surface);
    expect(textContent).toContain('Score board');
    expect(textContent).toContain('Host view: Ada has 0 points');
    expect(querySelectorAllDeep(surface, 'a2ui-mcp-app').length).toBe(1);
  });

  it('should load the sandbox proxy from the explorer origin with the app title', () => {
    const url = new URL(frame.src);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/a2ui-sandbox/sandbox.html');
    expect(frame.title).toBe('Score pad');
  });

  it('should initialize the app inside the sandbox', async () => {
    // The app asks for a height of 140px once ui/initialize succeeded.
    await waitFor(() => frame.style.height === '140px', 'the app asked for its size');
  });

  it('should update the surface data model from the host side', async () => {
    const input = querySelectorAllDeep(surface, 'input')[0] as HTMLInputElement;
    expect(input.value).toBe('Ada');

    input.value = 'Grace';
    input.dispatchEvent(new Event('input'));
    await whenSettled(gallery);

    expect(getDeepTextContent(surface)).toContain('Host view: Grace has 0 points');
    // The data model inspector follows the write.
    expect(JSON.parse(gallery.currentDataModelText)).toEqual({player: {name: 'Grace', score: 0}});
  });
});
