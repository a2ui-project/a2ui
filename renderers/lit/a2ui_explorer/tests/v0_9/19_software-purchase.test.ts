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

describe('Example: Software Purchase', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('19_software-purchase.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Purchase License');
    expect(textContent).toContain('Design Suite Pro');
    expect(textContent).toContain('Number of seats');
    expect(textContent).toContain('10 seats');
    expect(textContent).toContain('Billing period');
    expect(textContent).toContain('Annual');
    expect(textContent).toContain('Monthly');
    expect(textContent).toContain('Total');
    expect(textContent).toContain('Confirm Purchase');
    expect(textContent).toContain('Cancel');
  });

  it('should render formatted currency', async () => {
    expect(textContent).toContain('1,188');
  });

  it('should handle Confirm Purchase button click', async () => {
    const confirmBtn = await findButtonByText(surface, 'Confirm Purchase');

    confirmBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('confirm');
  });

  it('should handle Cancel button click', async () => {
    const cancelBtn = await findButtonByText(surface, 'Cancel');

    cancelBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('cancel');
  });
});
