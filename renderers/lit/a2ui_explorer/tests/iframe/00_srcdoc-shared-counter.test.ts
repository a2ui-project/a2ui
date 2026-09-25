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

describe('Example: Srcdoc Shared Counter', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;
  let frame: HTMLIFrameElement;

  beforeEach(async () => {
    gallery = await loadExample('iframe/00_srcdoc-shared-counter.json');
    surface = getSurface(gallery);
    frame = querySelectorAllDeep(surface, 'iframe')[0] as HTMLIFrameElement;
  });

  afterEach(() => {
    gallery?.remove();
  });

  it('should render the sibling basic components', () => {
    const textContent = getDeepTextContent(surface);
    expect(textContent).toContain('Shared counter');
    expect(textContent).toContain('Host view: 0 clicks');
    expect(querySelectorAllDeep(surface, 'a2ui-web-app-frame-srcdoc').length).toBe(1);
  });

  it('should load the sandbox proxy for inline content from the explorer origin', () => {
    const url = new URL(frame.src);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/a2ui-sandbox/sandbox.html');
    expect(url.searchParams.get('disable_security_self_test')).toBe('true');
    expect(frame.title).toBe('Embedded web application');
  });

  it('should apply the height property to the frame element', () => {
    const element = querySelectorAllDeep(surface, 'a2ui-web-app-frame-srcdoc')[0] as HTMLElement;
    expect(element.style.height).toBe('160px');
  });

  it('should complete the handshake with the app inside the sandbox', async () => {
    // The app reports its size right after the a2ui_app_frame_init handshake, so a resized frame
    // proves the proxy was served and the a2ui_* round trip works in the explorer.
    await waitFor(() => frame.style.height !== '', 'the app asked for its size');
  });

  it('should update the surface data model from the host side', async () => {
    const input = querySelectorAllDeep(surface, 'input')[0] as HTMLInputElement;
    expect(input.value).toBe('clicks');

    input.value = 'taps';
    input.dispatchEvent(new Event('input'));
    await whenSettled(gallery);

    expect(getDeepTextContent(surface)).toContain('Host view: 0 taps');
    // The data model inspector follows the write.
    expect(JSON.parse(gallery.currentDataModelText)).toEqual({counter: {count: 0, label: 'taps'}});
  });
});
