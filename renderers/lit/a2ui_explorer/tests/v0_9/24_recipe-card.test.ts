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

describe('Example: Recipe Card', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('24_recipe-card.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
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
    expect(querySelectorAllDeep(surface, 'a2ui-icon')[0] as HTMLElement).toBeTruthy();
  });

  it('should switch to Ingredients tab', async () => {
    const tabs = querySelectorAllDeep(surface, '.a2ui-tab-button') as HTMLElement[];
    const tab = tabs.find(t => t.textContent.includes('Ingredients'))!;
    expect(tab).withContext('Should find Ingredients tab').toBeTruthy();

    tab.click();
    await whenSettled(gallery);

    const ingredientsText = getDeepTextContent(surface);
    expect(ingredientsText).toContain('1 cup quinoa');
    expect(ingredientsText).toContain('1 cucumber, diced');
  });

  it('should switch to Instructions tab', async () => {
    const tabs = querySelectorAllDeep(surface, '.a2ui-tab-button') as HTMLElement[];
    const tab = tabs.find(t => t.textContent.includes('Instructions'))!;
    expect(tab).withContext('Should find Instructions tab').toBeTruthy();

    tab.click();
    await whenSettled(gallery);

    const instructionsText = getDeepTextContent(surface);
    expect(instructionsText).toContain('Rinse quinoa and bring to a boil in water.');
    expect(instructionsText).toContain('Mix with diced vegetables.');
  });
});
