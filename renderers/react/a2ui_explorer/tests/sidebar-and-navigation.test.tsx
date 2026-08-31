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
import {loadExample, cleanup, whenSettled} from './utils/test-utils';

describe('React Explorer Sidebars & Navigation', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = await loadExample('00_simple-text.json');
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should toggle left sidebar collapse and expand', async () => {
    const navPane = container.querySelector('[class*="navPane"]') as HTMLElement;
    const collapseBtn = container.querySelector('[class*="collapseLeftBtn"]') as HTMLButtonElement;

    expect(navPane.className).not.toContain('collapsed');
    expect(collapseBtn).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      collapseBtn.click();
      await whenSettled();
    });

    expect(navPane.className).toContain('collapsed');

    const expandBtn = container.querySelector('[class*="expandLeftBtn"]') as HTMLButtonElement;
    expect(expandBtn).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      expandBtn.click();
      await whenSettled();
    });

    expect(navPane.className).not.toContain('collapsed');
  });

  it('should toggle right inspector sidebar collapse and expand', async () => {
    const inspectorPane = container.querySelector('[class*="inspectorPane"]') as HTMLElement;
    const collapseBtn = container.querySelector('[class*="collapseRightBtn"]') as HTMLButtonElement;

    expect(inspectorPane.className).not.toContain('collapsed');
    expect(collapseBtn).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      collapseBtn.click();
      await whenSettled();
    });

    expect(inspectorPane.className).toContain('collapsed');

    const expandBtn = container.querySelector('[class*="expandRightBtn"]') as HTMLButtonElement;
    expect(expandBtn).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      expandBtn.click();
      await whenSettled();
    });

    expect(inspectorPane.className).not.toContain('collapsed');
  });

  it('should navigate to next and previous examples with j and k keys', async () => {
    const getActiveTitle = () =>
      container.querySelector('[class*="navItem"][class*="active"] [class*="navTitle"]')
        ?.textContent;

    const initialTitle = getActiveTitle();

    // Press 'j' -> Next example
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {key: 'j'}));
      await whenSettled();
    });

    const nextTitle = getActiveTitle();
    expect(nextTitle).not.toEqual(initialTitle);

    // Press 'k' -> Previous example
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {key: 'k'}));
      await whenSettled();
    });

    expect(getActiveTitle()).toEqual(initialTitle);
  });
});
