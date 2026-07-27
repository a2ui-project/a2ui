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

describe('Example: Track List (basic) (v0.8)', () => {
  let textContent: string;

  beforeEach(async () => {
    await loadExample('Track List (basic)', Version.V0_8);
    textContent = getCanvas().textContent;
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('1');
    expect(textContent).toContain('2');
    expect(textContent).toContain('3');
    expect(textContent).toContain('Focus Flow');
    expect(textContent).toContain('Weightless');
    expect(textContent).toContain('Marconi Union');
    expect(textContent).toContain('8:09');
    expect(textContent).toContain('Clair de Lune');
    expect(textContent).toContain('Debussy');
    expect(textContent).toContain('5:12');
    expect(textContent).toContain('Ambient Light');
    expect(textContent).toContain('Brian Eno');
    expect(textContent).toContain('6:45');
  });
});
