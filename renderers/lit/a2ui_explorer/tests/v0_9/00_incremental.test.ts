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

describe('Example: Incremental', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('00_incremental.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render expected restaurants', async () => {
    expect(textContent).toContain('The Golden Fork');
    expect(textContent).toContain("Ocean's Bounty");
    expect(textContent).toContain('Pizzeria Roma');
    expect(textContent).toContain('Spice Route');
  });

  it('should render Book now button for each restaurant', async () => {
    const buttons = querySelectorAllDeep(surface, '.a2ui-button') as HTMLButtonElement[];
    expect(buttons.length).toBe(4);
    expect(getDeepTextContent(buttons[0])).toContain('Book now');
  });

  it('should dispatch book_now action when a Book now button is clicked', async () => {
    const buttons = querySelectorAllDeep(surface, '.a2ui-button') as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);

    buttons[0].click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBeGreaterThan(0);
    const loggedAction = gallery.actionLog[0];
    expect(loggedAction.name).toBe('book_now');
    expect(loggedAction.context).toEqual({
      restaurantName: 'The Golden Fork',
    });
  });
});
