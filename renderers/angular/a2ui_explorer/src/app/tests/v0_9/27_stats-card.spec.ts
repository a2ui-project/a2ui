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

describe('Example: Stats Card', () => {
  let textContent: string;

  beforeEach(async () => {
    await loadExample('Stats Card');
    textContent = getCanvas().textContent;
  });

  it('should render text content and icons', async () => {
    expect(textContent).toContain('trending_up');
    expect(textContent).toContain('Monthly Revenue');
    expect(textContent).toContain('arrow_upward');
  });
});
