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
describe('Example: Recipe Card', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('24_recipe-card.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render tab titles', async () => {
    expect(textContent).toContain('Overview');
    expect(textContent).toContain('Ingredients');
    expect(textContent).toContain('Instructions');
  });

  it('should render Overview content', async () => {
    expect(textContent).toContain('Mediterranean Quinoa Bowl');
    expect(textContent).toContain('4.9');
    expect(textContent).toContain('15 min prep');
    expect(textContent).toContain('20 min cook');
    expect(textContent).toContain('Serves 4');
  });

  it('should render icon', async () => {
    expect(
      Array.from(
        surface.querySelectorAll('.material-symbols-outlined, .a2ui-icon'),
      )[0] as HTMLElement,
    ).toBeTruthy();
  });

  it('should switch to Ingredients tab', async () => {
    const tabs = Array.from(surface.querySelectorAll('.a2ui-tab-button')) as HTMLElement[];
    const tab = tabs.find(t => t.textContent?.includes('Ingredients'));
    expect(tab).withContext('Should find Ingredients tab').toBeTruthy();

    await act(async () => {
      tab?.click();
      await whenSettled();
    });

    const ingredientsText = surface.textContent || '';
    expect(ingredientsText).toContain('1 cup quinoa');
    expect(ingredientsText).toContain('1 cucumber, diced');
  });

  it('should switch to Instructions tab', async () => {
    const tabs = Array.from(surface.querySelectorAll('.a2ui-tab-button')) as HTMLElement[];
    const tab = tabs.find(t => t.textContent?.includes('Instructions'));
    expect(tab).withContext('Should find Instructions tab').toBeTruthy();

    await act(async () => {
      tab?.click();
      await whenSettled();
    });

    const instructionsText = surface.textContent || '';
    expect(instructionsText).toContain('Rinse quinoa and bring to a boil in water.');
    expect(instructionsText).toContain('Mix with diced vegetables.');
  });
});
