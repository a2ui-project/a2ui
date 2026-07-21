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
} from '../utils/test-utils';
import {LocalGallery} from '../../src/local-gallery';

describe('Example: Financial Data Grid', () => {
  let gallery: LocalGallery;
  let surface: HTMLElement;

  afterEach(() => {
    gallery?.remove();
  });
  let textContent: string;

  beforeEach(async () => {
    gallery = await loadExample('33_financial-data-grid.json');
    surface = getSurface(gallery);
    textContent = getDeepTextContent(surface);
  });

  it('should render table headers', async () => {
    expect(textContent).toContain('Asset');
    expect(textContent).toContain('Price');
    expect(textContent).toContain('24h Change');
    expect(textContent).toContain('Market Cap');
  });

  it('should render asset names and symbols', async () => {
    expect(textContent).toContain('Bitcoin');
    expect(textContent).toContain('BTC');
    expect(textContent).toContain('Ethereum');
    expect(textContent).toContain('ETH');
    expect(textContent).toContain('Solana');
    expect(textContent).toContain('SOL');
  });

  it('should render icon', async () => {
    expect(querySelectorAllDeep(surface, 'a2ui-icon')[0] as HTMLElement).toBeTruthy();
    expect(textContent).toContain('payment');
  });
});
