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
describe('Example: Contact Card', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('25_contact-card.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render text content', async () => {
    expect(textContent).toContain('David Park');
    expect(textContent).toContain('Engineering Manager');
    expect(textContent).toContain('+1 (555) 234-5678');
    expect(textContent).toContain('david.park@company.com');
    expect(textContent).toContain('San Francisco, CA');
    expect(textContent).toContain('Call');
    expect(textContent).toContain('Message');
  });

  it('should render image', async () => {
    const img = Array.from(surface.querySelectorAll('img'))[0] as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
    );
  });

  it('should render icons', async () => {
    const icons = Array.from(surface.querySelectorAll('.material-symbols-outlined, .a2ui-icon'));
    expect(icons.length).toBeGreaterThanOrEqual(3);

    expect(textContent).toContain('location_on');
    expect(textContent).toContain('phone');
    expect(textContent).toContain('mail');
  });

  it('should handle Call button click', async () => {
    const callBtn = await findButtonByText(surface, 'Call');

    await act(async () => {
      callBtn.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('call');
  });

  it('should handle Message button click', async () => {
    const messageBtn = await findButtonByText(surface, 'Message');

    await act(async () => {
      messageBtn.click();
      await whenSettled();
    });

    expect(actionSpy.calls.count()).toBe(1);
    expect(actionSpy.calls.mostRecent().args[0].name).toBe('message');
  });
});
