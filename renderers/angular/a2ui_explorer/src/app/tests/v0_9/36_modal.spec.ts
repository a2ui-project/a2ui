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

import {loadExample, wait} from '../utils';

describe('Example: Modal', () => {
  it('should open and close modal', async () => {
    const fixture = await loadExample('Modal Sample');

    // Check if trigger is rendered
    const trigger = fixture.nativeElement.querySelector('.a2ui-modal-trigger');
    expect(trigger).toBeTruthy();

    // Check modal is closed initially
    expect(fixture.nativeElement.querySelector('.a2ui-modal-overlay')).toBeFalsy();

    // Click trigger
    trigger.click();
    fixture.detectChanges();
    await wait(100);
    fixture.detectChanges();

    // Check modal is open
    expect(fixture.nativeElement.querySelector('.a2ui-modal-overlay')).toBeTruthy();

    // Check content
    expect(fixture.nativeElement.querySelector('.a2ui-modal-overlay').textContent).toContain(
      'This is the content inside the modal.',
    );

    // Click close button
    const closeBtn = fixture.nativeElement.querySelector('.a2ui-modal-close');
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    fixture.detectChanges();

    // Check modal is closed
    expect(fixture.nativeElement.querySelector('.a2ui-modal-overlay')).toBeFalsy();
  });
});
