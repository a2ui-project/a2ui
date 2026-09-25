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

import {getSurface, loadExample, querySelectorAllDeep, waitFor} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Inline Tool Call', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;
  let frame: HTMLIFrameElement;

  beforeEach(async () => {
    gallery = await loadExample('mcp/00_inline-tool-call.json');
    surface = getSurface(gallery);
    frame = querySelectorAllDeep(surface, 'iframe')[0] as HTMLIFrameElement;
  });

  afterEach(() => {
    gallery?.remove();
  });

  it('should render the app as the root component', () => {
    expect(surface.shadowRoot?.firstElementChild?.tagName.toLowerCase()).toBe('a2ui-mcp-app');
    expect(querySelectorAllDeep(surface, 'iframe').length).toBe(1);
  });

  it('should load the sandbox proxy from the explorer origin with the app title', () => {
    const url = new URL(frame.src);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/a2ui-sandbox/sandbox.html');
    expect(url.searchParams.get('disable_security_self_test')).toBe('true');
    expect(frame.title).toBe('Feedback form');
  });

  it('should initialize the app inside the sandbox', async () => {
    // The app asks for a height of 180px once ui/initialize succeeded, so the resized frame proves
    // the proxy was served and the MCP Apps round trip works in the explorer.
    await waitFor(() => frame.style.height === '180px', 'the app asked for its size');
  });
});
