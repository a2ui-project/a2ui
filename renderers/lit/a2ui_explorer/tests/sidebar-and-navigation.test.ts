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

  it('should render combined header with A2UI Lit Explorer title and example info in right panel', () => {
    const brandTitle = gallery.shadowRoot?.querySelector('.preview-header h1');
    expect(brandTitle?.textContent).toBe('A2UI Lit Explorer');
    expect(gallery.shadowRoot?.querySelector('header')).toBeNull();
    expect(
      gallery.shadowRoot?.querySelector('.inspector-pane-header h2')?.textContent,
    ).toBeTruthy();
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

  it('should fold and unfold inspector sections and support live JSON editing', async () => {
    const surfaceSection = gallery.shadowRoot?.querySelector('.surface-section') as HTMLElement;
    const surfaceHeader = surfaceSection.querySelector('.inspector-header') as HTMLElement;
    expect(surfaceSection.classList.contains('folded')).toBeFalse();

    surfaceHeader.click();
    await whenSettled(gallery);
    expect(surfaceSection.classList.contains('folded')).toBeTrue();

    surfaceHeader.click();
    await whenSettled(gallery);
    expect(surfaceSection.classList.contains('folded')).toBeFalse();

    const dataModelTextarea = gallery.shadowRoot?.querySelector(
      '.data-model-textarea',
    ) as HTMLTextAreaElement;
    expect(dataModelTextarea).toBeTruthy();

    dataModelTextarea.value = '{invalid json';
    dataModelTextarea.dispatchEvent(new Event('input'));
    await whenSettled(gallery);
    expect(gallery.dataModelError).toBeTruthy();

    dataModelTextarea.value = '{"testKey": "updated"}';
    dataModelTextarea.dispatchEvent(new Event('input'));
    await whenSettled(gallery);
    expect(gallery.dataModelError).toBeNull();
  });
});
