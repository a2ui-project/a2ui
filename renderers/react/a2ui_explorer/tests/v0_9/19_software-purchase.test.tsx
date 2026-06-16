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
import {loadExample, cleanup, getSurface, findButtonByText, whenSettled} from '../utils/test-utils';
describe('Example: Software Purchase', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('19_software-purchase.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Purchase License');
    expect(textContent).toContain('Design Suite Pro');
    expect(textContent).toContain('Number of seats');
    expect(textContent).toContain('10 seats');
    expect(textContent).toContain('Billing period');
    expect(textContent).toContain('Annual');
    expect(textContent).toContain('Monthly');
    expect(textContent).toContain('Total');
    expect(textContent).toContain('Confirm Purchase');
    expect(textContent).toContain('Cancel');
  });

  it('should render formatted currency', async () => {
    expect(textContent).toContain('1,188');
  });

  it('should handle Confirm Purchase button click', async () => {
    const confirmBtn = await findButtonByText(surface, 'Confirm Purchase');

    await act(async () => {
      confirmBtn.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('confirm');
  });

  it('should handle Cancel button click', async () => {
    const cancelBtn = await findButtonByText(surface, 'Cancel');

    await act(async () => {
      cancelBtn.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('cancel');
  });
});
