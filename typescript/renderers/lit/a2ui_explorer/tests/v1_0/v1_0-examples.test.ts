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

import {loadExample, getSurface, getDeepTextContent, whenSettled} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Lit Explorer v1.0 Examples & Version Toggle', () => {
  let gallery: LocalGallery;

  afterEach(() => {
    gallery?.remove();
  });

  it('should switch between v0.9 and v1.0 via the header version selector', async () => {
    gallery = await loadExample('00_simple-text.json', '0.9');
    expect(gallery.specVersion).toBe('0.9');

    const versionBtns = Array.from(
      gallery.shadowRoot?.querySelectorAll('.version-btn') ?? [],
    ) as HTMLButtonElement[];
    expect(versionBtns.length).toBe(2);

    const v10Btn = versionBtns.find(btn => btn.textContent?.trim() === 'v1.0');
    expect(v10Btn).toBeTruthy();

    v10Btn!.click();
    await whenSettled(gallery);

    expect(gallery.specVersion).toBe('1.0');
    expect(v10Btn!.classList.contains('active')).toBeTrue();

    const surface = getSurface(gallery);
    expect(getDeepTextContent(surface)).toContain('Hello, Minimal Catalog!');
  });

  it('should render v1.0 00_simple-text.json', async () => {
    gallery = await loadExample('00_simple-text.json', '1.0');
    const surface = getSurface(gallery);
    expect(getDeepTextContent(surface)).toContain('Hello, Minimal Catalog!');
    expect(gallery.mockLogs.filter(l => l.includes('Error'))).toEqual([]);
  });

  it('should render v1.0 02_email-compose.json', async () => {
    gallery = await loadExample('02_email-compose.json', '1.0');
    const surface = getSurface(gallery);
    const text = getDeepTextContent(surface);
    expect(text).toContain('Send');
    expect(gallery.mockLogs.filter(l => l.includes('Error'))).toEqual([]);
  });

  it('should render v1.0 34_child-list-template.json with template expansion', async () => {
    gallery = await loadExample('34_child-list-template.json', '1.0');
    const surface = getSurface(gallery);
    const text = getDeepTextContent(surface);
    expect(text).toContain('Dynamic Item List');
    expect(text).toContain('Apple');
    expect(text).toContain('Banana');
    expect(text).toContain('Cherry');
    expect(gallery.mockLogs.filter(l => l.includes('Error'))).toEqual([]);
  });

  it('should render v1.0 31_incremental-dashboard.json cleanly', async () => {
    gallery = await loadExample('31_incremental-dashboard.json', '1.0');
    const surface = getSurface(gallery);
    expect(surface).toBeTruthy();
    expect(gallery.mockLogs.filter(l => l.includes('Error'))).toEqual([]);
  });
});
