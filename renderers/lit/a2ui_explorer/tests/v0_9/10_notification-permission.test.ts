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

describe('Example: Notification Permission', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('10_notification-permission.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Enable notification');

    // Check for description
    expect(textContent).toContain('Get alerts for order status changes');

    // Check for buttons
    expect(textContent).toContain('Yes');
    expect(textContent).toContain('No');
  });

  it('should render icon', async () => {
    const iconEl = querySelectorAllDeep(surface, 'a2ui-icon')[0] as HTMLElement;
    expect(iconEl).toBeTruthy();
    expect(getDeepTextContent(iconEl)).toContain('check');
  });

  it('should handle Yes button click', async () => {
    const yesBtn = await findButtonByText(surface, 'Yes');

    yesBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('accept');
  });

  it('should handle No button click', async () => {
    const noBtn = await findButtonByText(surface, 'No');

    noBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('decline');
  });
});
