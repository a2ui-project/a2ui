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

import {act} from 'react';
import {loadExample, cleanup, getSurface, findButtonByText, whenSettled} from '../utils/test-utils';
describe('Example: Notification Permission', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('10_notification-permission.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
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
    const iconEl = Array.from(
      surface.querySelectorAll('.material-symbols-outlined, .a2ui-icon'),
    )[0] as HTMLElement;
    expect(iconEl).toBeTruthy();
    expect(iconEl.textContent || '').toContain('check');
  });

  it('should handle Yes button click', async () => {
    const yesBtn = await findButtonByText(surface, 'Yes');

    await act(async () => {
      yesBtn.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('accept');
  });

  it('should handle No button click', async () => {
    const noBtn = await findButtonByText(surface, 'No');

    await act(async () => {
      noBtn.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('decline');
  });
});
