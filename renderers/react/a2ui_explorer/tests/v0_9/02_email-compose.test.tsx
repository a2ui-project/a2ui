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
import {loadExample, cleanup, findButtonByText, whenSettled, getSurface} from '../utils/test-utils';

describe('Example: Email Compose', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('02_email-compose.json', actionSpy);
    surface = getSurface(container);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should render text content', async () => {
    const textContent = surface.textContent;

    expect(textContent).toContain('FROM');
    expect(textContent).toContain('TO');
    expect(textContent).toContain('SUBJECT');
    expect(textContent).toContain('Send email');
    expect(textContent).toContain('Discard');
    expect(textContent).toContain('alex@acme.com');
  });

  it('should handle Send button click', async () => {
    const sendBtn = findButtonByText(surface, 'Send');

    await act(async () => {
      sendBtn.click();
      await whenSettled();
    });

    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('send');
  });

  it('should handle Discard button click', async () => {
    const discardBtn = findButtonByText(surface, 'Discard');

    await act(async () => {
      discardBtn.click();
      await whenSettled();
    });

    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('discard');
  });
});
