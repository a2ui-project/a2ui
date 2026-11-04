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

import {act} from 'react';
import {loadExample, cleanup, getSurface, whenSettled, changeInputValue} from '../utils/test-utils';

describe('v1.0 Example: Simple Login Form', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('00_simple-login-form.json', '1.0', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Login');
    expect(textContent).toContain('Sign In');
  });

  it('should dispatch login_submitted action with the form contents on button click', async () => {
    const inputs = Array.from(surface.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      changeInputValue(inputs[0], 'testuser');
      changeInputValue(inputs[1], 'testpass');
      await whenSettled();
    });

    const buttons = Array.from(surface.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    const btn = buttons[0];

    await act(async () => {
      btn.click();
      await whenSettled();
    });

    expect(actionSpy).toHaveBeenCalled();
    const loggedAction = actionSpy.calls.mostRecent().args[0];
    expect(loggedAction.name).toBe('login_submitted');
    expect(loggedAction.context).toEqual({
      user: 'testuser',
      pass: 'testpass',
    });
  });
});
