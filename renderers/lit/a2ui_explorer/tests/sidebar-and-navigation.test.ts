/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {loadExample, whenSettled} from './utils/test-utils';
import {LocalGallery} from '../src/local-gallery';

describe('Lit Explorer Sidebars & Navigation', () => {
  let gallery: LocalGallery;

  beforeEach(async () => {
    gallery = await loadExample('00_simple-text.json');
  });

  afterEach(() => {
    gallery?.remove();
  });

  it('should toggle left sidebar collapse and expand', async () => {
    const navPane = gallery.shadowRoot?.querySelector('.nav-pane') as HTMLElement;
    const collapseBtn = gallery.shadowRoot?.querySelector(
      '.collapse-left-btn',
    ) as HTMLButtonElement;

    expect(navPane.classList.contains('collapsed')).toBeFalse();
    expect(collapseBtn).toBeTruthy();

    collapseBtn.click();
    await whenSettled(gallery);

    expect(navPane.classList.contains('collapsed')).toBeTrue();

    const expandBtn = gallery.shadowRoot?.querySelector('.expand-left-btn') as HTMLButtonElement;
    expect(expandBtn).toBeTruthy();

    expandBtn.click();
    await whenSettled(gallery);

    expect(navPane.classList.contains('collapsed')).toBeFalse();
  });

  it('should toggle right inspector sidebar collapse and expand', async () => {
    const inspectorPane = gallery.shadowRoot?.querySelector('.inspector-pane') as HTMLElement;
    const collapseBtn = gallery.shadowRoot?.querySelector(
      '.collapse-right-btn',
    ) as HTMLButtonElement;

    expect(inspectorPane.classList.contains('collapsed')).toBeFalse();
    expect(collapseBtn).toBeTruthy();

    collapseBtn.click();
    await whenSettled(gallery);

    expect(inspectorPane.classList.contains('collapsed')).toBeTrue();

    const expandBtn = gallery.shadowRoot?.querySelector('.expand-right-btn') as HTMLButtonElement;
    expect(expandBtn).toBeTruthy();

    expandBtn.click();
    await whenSettled(gallery);

    expect(inspectorPane.classList.contains('collapsed')).toBeFalse();
  });

  it('should navigate to next and previous examples with j and k keys', async () => {
    const initialIndex = gallery.activeItemIndex;

    // Press 'j' -> Next example
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'j'}));
    await whenSettled(gallery);

    expect(gallery.activeItemIndex).toBe(initialIndex + 1);

    // Press 'k' -> Previous example
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'k'}));
    await whenSettled(gallery);

    expect(gallery.activeItemIndex).toBe(initialIndex);
  });
});
