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

import {getCanvas, loadExample} from '../utils';

describe('Example: Weather Current', () => {
  let textContent: string;

  beforeEach(async () => {
    await loadExample('Weather Current');
    textContent = getCanvas().textContent;
  });

  it('should render main content', async () => {
    expect(textContent).toContain('Austin, TX');
    expect(textContent).toContain('Clear skies with light breeze');
    expect(textContent).toContain('72°');
    expect(textContent).toContain('58°');
  });

  it('should render icons', async () => {
    expect(textContent).toContain('☀️');
    expect(textContent).toContain('⛅');
  });

  it('should render forecast temperatures', async () => {
    expect(textContent).toContain('74°');
    expect(textContent).toContain('76°');
    expect(textContent).toContain('71°');
    expect(textContent).toContain('73°');
    expect(textContent).toContain('75°');
  });

  it('should render day names for forecast', async () => {
    const hasDayName =
      textContent.includes('Tue') ||
      textContent.includes('Wed') ||
      textContent.includes('Thu') ||
      textContent.includes('Fri') ||
      textContent.includes('Sat');
    expect(hasDayName).withContext('Should render day names for forecast').toBeTruthy();
  });
});
