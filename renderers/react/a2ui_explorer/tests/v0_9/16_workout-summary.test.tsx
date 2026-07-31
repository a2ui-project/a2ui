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

import {loadExample, cleanup, getSurface} from '../utils/test-utils';
describe('Example: Workout Summary', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('16_workout-summary.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Workout Complete');
    expect(textContent).toContain('Duration');
    expect(textContent).toContain('32:15');
    expect(textContent).toContain('Calories');
    expect(textContent).toContain('385');
    expect(textContent).toContain('Distance');
    expect(textContent).toContain('5.2 km');
  });

  it('should render icon', async () => {
    expect(
      Array.from(
        surface.querySelectorAll('.material-symbols-outlined, .a2ui-icon'),
      )[0] as HTMLElement,
    ).toBeTruthy();
    expect(textContent).toContain('directions_run');
  });
});
