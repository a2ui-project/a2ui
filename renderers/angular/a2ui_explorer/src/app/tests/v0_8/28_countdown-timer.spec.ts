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

import {Version, getCanvas, loadExample} from '../utils/test_utils';

describe('Example: Countdown Timer (basic) (v0.8)', () => {
  let textContent: string;

  beforeEach(async () => {
    await loadExample('Countdown Timer (basic)', Version.V0_8);
    textContent = getCanvas().textContent;
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Days');
    expect(textContent).toContain('Hours');
    expect(textContent).toContain('Minutes');
    expect(textContent).toContain('Product Launch');
    expect(textContent).toContain('14');
    expect(textContent).toContain('08');
    expect(textContent).toContain('32');
    expect(textContent).toContain('January 15, 2025');
  });
});
