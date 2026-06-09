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

describe('Example: Account Balance', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('15_account-balance.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Primary Checking');
    expect(textContent).toContain('Updated just now');
    expect(textContent).toContain('Transfer');
    expect(textContent).toContain('Pay Bill');

    // Check for formatted currency (best effort)
    expect(textContent).toContain('12,458.32');
  });

  it('should render icon', async () => {
    expect(querySelectorAllDeep(surface, 'a2ui-icon')[0] as HTMLElement).toBeTruthy();
    expect(textContent).toContain('payment');
  });

  it('should handle Transfer button click', async () => {
    const transferBtn = await findButtonByText(surface, 'Transfer');

    transferBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('transfer');
  });

  it('should handle Pay Bill button click', async () => {
    const payBtn = await findButtonByText(surface, 'Pay Bill');

    payBtn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBe(1);
    expect(gallery.actionLog[0].name).toBe('pay_bill');
  });
});
