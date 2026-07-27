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

describe('Example: Interactive Button', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('00_interactive-button.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Click the button below');
    expect(textContent).toContain('Click Me');
  });

  it('should dispatch button_clicked action on button click', async () => {
    const buttons = querySelectorAllDeep(surface, '.a2ui-button') as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    const btn = buttons[0];

    btn.click();
    await whenSettled(gallery);

    expect(gallery.actionLog.length).toBeGreaterThan(0);
    const loggedAction = gallery.actionLog[0];
    expect(loggedAction.name).toBe('button_clicked');
  });
});
