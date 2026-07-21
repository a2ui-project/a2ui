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
  whenSettled,
  findButtonByText,
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Event Detail', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('17_event-detail.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Product Launch Meeting');

    // Check for location
    expect(textContent).toContain('Conference Room A, Building 2');

    // Check for description
    expect(textContent).toContain(
      'Review final product specs and marketing materials before the Q1 launch.',
    );

    // Check for buttons
    expect(textContent).toContain('Accept');
    expect(textContent).toContain('Decline');

    // Check for date/time (approximate or specific if we trust UTC)
    expect(textContent).toContain('Dec 19');
  });

  it('should render icons', async () => {
    const icons = querySelectorAllDeep(surface, 'a2ui-icon');
    expect(icons.length).toBeGreaterThanOrEqual(2);

    expect(textContent).toContain('calendar_today');
    expect(textContent).toContain('location_on');
  });

  it('should handle Accept button click', async () => {
    const acceptBtn = await findButtonByText(surface, 'Accept');

    acceptBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('accept');
  });

  it('should handle Decline button click', async () => {
    const declineBtn = await findButtonByText(surface, 'Decline');

    declineBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('decline');
  });
});
