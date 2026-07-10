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

describe('Example: Incremental', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('00_incremental.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render expected restaurants', async () => {
    expect(textContent).toContain('The Golden Fork');
    expect(textContent).toContain("Ocean's Bounty");
    expect(textContent).toContain('Pizzeria Roma');
    expect(textContent).toContain('Spice Route');
  });

  it('should render Book now button for each restaurant', async () => {
    const buttons = Array.from(surface.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.length).toBe(4);
    expect(buttons[0].textContent).toContain('Book now');
  });

  it('should dispatch book_now action when a Book now button is clicked', async () => {
    const buttons = Array.from(surface.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);

    await act(async () => {
      buttons[0].click();
      await whenSettled();
    });

    expect(actionSpy).toHaveBeenCalled();
    const loggedAction = actionSpy.calls.mostRecent().args[0];
    expect(loggedAction.name).toBe('book_now');
    expect(loggedAction.context).toEqual({
      restaurantName: 'The Golden Fork',
    });
  });
});
