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
import {loadExample, cleanup, getSurface, whenSettled} from '../utils/test-utils';
describe('Example: Modal', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  it('should open and close modal', async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('36_modal.json', actionSpy);
    surface = getSurface(container);

    // Check if trigger is rendered
    const trigger = Array.from(surface.querySelectorAll('.a2ui-modal-trigger'))[0] as HTMLElement;
    expect(trigger).toBeTruthy();

    // Check modal is closed initially
    expect(Array.from(surface.querySelectorAll('.a2ui-modal-overlay'))[0]).toBeFalsy();

    // Click trigger
    await act(async () => {
      trigger.click();
      await whenSettled();
    });

    // Check modal is open
    expect(Array.from(surface.querySelectorAll('.a2ui-modal-overlay'))[0]).toBeTruthy();

    // Check content
    expect(
      Array.from(surface.querySelectorAll('.a2ui-modal-overlay'))[0].textContent || '',
    ).toContain('This is the content inside the modal.');

    // Click close button
    const closeBtn = Array.from(surface.querySelectorAll('.a2ui-modal-close'))[0] as HTMLElement;
    expect(closeBtn).toBeTruthy();
    await act(async () => {
      closeBtn.click();
      await whenSettled();
    });

    // Check modal is closed
    expect(Array.from(surface.querySelectorAll('.a2ui-modal-overlay'))[0]).toBeFalsy();
  });
});
