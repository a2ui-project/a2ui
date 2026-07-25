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

describe('Example: Interactive Button', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('00_interactive-button.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Click the button below');
    expect(textContent).toContain('Click Me');
  });

  it('should dispatch button_clicked action on button click', async () => {
    const buttons = Array.from(surface.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    const btn = buttons[0];

    await act(async () => {
      btn.click();
      await whenSettled();
    });

    expect(actionSpy).toHaveBeenCalled();
    const loggedAction = actionSpy.calls.mostRecent().args[0];
    expect(loggedAction.name).toBe('button_clicked');
  });
});
