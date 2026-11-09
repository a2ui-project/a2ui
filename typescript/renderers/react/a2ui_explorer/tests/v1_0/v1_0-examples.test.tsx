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
import {loadExample, cleanup, getSurface, whenSettled} from '../utils/test-utils';

function getErrorLogs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[class*="logType"]'))
    .map(el => el.textContent ?? '')
    .filter(text => text.includes('Error'));
}

describe('React Explorer v1.0 Examples & Version Toggle', () => {
  let container: HTMLDivElement;

  afterEach(async () => {
    await cleanup();
  });

  it('should switch between v0.9 and v1.0 via the header version selector', async () => {
    container = await loadExample('00_simple-text.json', '0.9');

    const versionBtns = Array.from(
      container.querySelectorAll('[class*="versionBtn"]'),
    ) as HTMLButtonElement[];
    expect(versionBtns.length).toBe(2);

    const v09Btn = versionBtns.find(btn => btn.textContent?.trim() === 'v0.9');
    const v10Btn = versionBtns.find(btn => btn.textContent?.trim() === 'v1.0');
    expect(v09Btn?.className).toContain('versionBtnActive');
    expect(v10Btn).toBeTruthy();

    await act(async () => {
      v10Btn!.click();
      await whenSettled();
    });

    const updatedBtns = Array.from(
      container.querySelectorAll('[class*="versionBtn"]'),
    ) as HTMLButtonElement[];
    const updatedV10Btn = updatedBtns.find(btn => btn.textContent?.trim() === 'v1.0');
    expect(updatedV10Btn?.className).toContain('versionBtnActive');

    const surface = getSurface(container);
    expect(surface.textContent).toContain('Hello, Minimal Catalog!');
  });

  it('should render v1.0 00_simple-text.json', async () => {
    container = await loadExample('00_simple-text.json', '1.0');
    const surface = getSurface(container);
    expect(surface.textContent).toContain('Hello, Minimal Catalog!');
    expect(getErrorLogs(container)).toEqual([]);
  });

  it('should render v1.0 02_email-compose.json', async () => {
    container = await loadExample('02_email-compose.json', '1.0');
    const surface = getSurface(container);
    const text = surface.textContent || '';
    expect(text).toContain('Send');
    expect(getErrorLogs(container)).toEqual([]);
  });

  it('should render v1.0 34_child-list-template.json with template expansion', async () => {
    container = await loadExample('34_child-list-template.json', '1.0');
    const surface = getSurface(container);
    const text = surface.textContent || '';
    expect(text).toContain('Dynamic Item List');
    expect(text).toContain('Apple');
    expect(text).toContain('Banana');
    expect(text).toContain('Cherry');
    expect(getErrorLogs(container)).toEqual([]);
  });

  it('should render v1.0 31_incremental-dashboard.json cleanly', async () => {
    container = await loadExample('31_incremental-dashboard.json', '1.0');
    const surface = getSurface(container);
    expect(surface).toBeTruthy();
    expect(getErrorLogs(container)).toEqual([]);
  });
});
