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
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Modal', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  it('should open and close modal', async () => {
    gallery = await loadExample('36_modal.json');
    surface = getSurface(gallery);

    // Check if trigger is rendered
    const trigger = querySelectorAllDeep(surface, '.a2ui-modal-trigger')[0] as HTMLElement;
    expect(trigger).toBeTruthy();

    // Check modal is closed initially
    expect(
      (querySelectorAllDeep(surface, '.a2ui-modal-overlay')[0] as HTMLDialogElement)?.open,
    ).toBeFalsy();

    // Click trigger
    trigger.click();
    await whenSettled(gallery);

    // Check modal is open
    expect(
      (querySelectorAllDeep(surface, '.a2ui-modal-overlay')[0] as HTMLDialogElement)?.open,
    ).toBeTruthy();

    // Check content
    expect(getDeepTextContent(querySelectorAllDeep(surface, '.a2ui-modal-overlay')[0])).toContain(
      'This is the content inside the modal.',
    );

    // Click close button
    const closeBtn = querySelectorAllDeep(surface, '.a2ui-modal-close')[0] as HTMLElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    await whenSettled(gallery);

    // Check modal is closed
    expect(
      (querySelectorAllDeep(surface, '.a2ui-modal-overlay')[0] as HTMLDialogElement)?.open,
    ).toBeFalsy();
  });
});
