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
describe('Example: Event Detail', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('17_event-detail.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
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
    const icons = Array.from(surface.querySelectorAll('.material-symbols-outlined, .a2ui-icon'));
    expect(icons.length).toBeGreaterThanOrEqual(2);

    expect(textContent).toContain('calendar_today');
    expect(textContent).toContain('location_on');
  });

  it('should handle Accept button click', async () => {
    const acceptBtn = await findButtonByText(surface, 'Accept');

    await act(async () => {
      acceptBtn.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('accept');
  });

  it('should handle Decline button click', async () => {
    const declineBtn = await findButtonByText(surface, 'Decline');

    await act(async () => {
      declineBtn.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('decline');
  });
});
