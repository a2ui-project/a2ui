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

  it('should render combined header with A2UI React Explorer title', () => {
    const brandTitle = container.querySelector('[class*="previewHeader"] h1');
    expect(brandTitle?.textContent).toBe('A2UI React Explorer');
    expect(container.querySelector('header')).toBeNull();
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

  it('should switch between v0.9 and v1.0 galleries using the version selector buttons', async () => {
    const versionBtns = Array.from(
      container.querySelectorAll('[class*="versionBtn"]'),
    ) as HTMLButtonElement[];
    expect(versionBtns.length).toBe(2);

    const v10Btn = versionBtns.find(btn => btn.textContent?.trim() === 'v1.0');
    expect(v10Btn).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      v10Btn!.click();
      await whenSettled();
    });

    const updatedBtns = Array.from(
      container.querySelectorAll('[class*="versionBtn"]'),
    ) as HTMLButtonElement[];
    const updatedV10Btn = updatedBtns.find(btn => btn.textContent?.trim() === 'v1.0');
    expect(updatedV10Btn?.className).toContain('versionBtnActive');
    const navItems = container.querySelectorAll('[class*="navItem"]');
    expect(navItems.length).toBeGreaterThan(0);
  });

  it('should fold and unfold inspector sections', async () => {
    const surfaceSection = container.querySelector('[class*="surfaceSection"]') as HTMLElement;
    const surfaceHeader = surfaceSection.querySelector('[class*="inspectorHeader"]') as HTMLElement;
    expect(surfaceSection.className).not.toContain('folded');

    await act(async () => {
      surfaceHeader.click();
      await whenSettled();
    });

    expect(surfaceSection.className).toContain('folded');

    await act(async () => {
      surfaceHeader.click();
      await whenSettled();
    });

    expect(surfaceSection.className).not.toContain('folded');
  });
});
