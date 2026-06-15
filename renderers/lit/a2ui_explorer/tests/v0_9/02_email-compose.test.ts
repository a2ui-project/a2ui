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
  whenSettled,
  findButtonByText,
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Email Compose', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  beforeEach(async () => {
    gallery = await loadExample('02_email-compose.json');
    surface = getSurface(gallery);
  });

  afterEach(() => {
    gallery.remove();
  });

  it('should render text content', async () => {
    const textContent = getDeepTextContent(surface);

    expect(textContent).toContain('FROM');
    expect(textContent).toContain('TO');
    expect(textContent).toContain('SUBJECT');
    expect(textContent).toContain('Send email');
    expect(textContent).toContain('Discard');
    expect(textContent).toContain('alex@acme.com');
  });

  it('should handle Send button click', async () => {
    const sendBtn = await findButtonByText(surface, 'Send');

    sendBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('send');
  });

  it('should handle Discard button click', async () => {
    const discardBtn = await findButtonByText(surface, 'Discard');

    discardBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('discard');
  });
});
