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

describe('Example: Calendar Day', () => {
  let textContent: string;

  beforeEach(async () => {
    await loadExample('Calendar Day');
    textContent = getCanvas().textContent;
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Lunch');
    expect(textContent).toContain('12:00 - 12:45 PM');
    expect(textContent).toContain('Q1 roadmap review');
    expect(textContent).toContain('1:00 - 2:00 PM');
    expect(textContent).toContain('Team standup');
    expect(textContent).toContain('3:30 - 4:00 PM');
    expect(textContent).toContain('Add to calendar');
    expect(textContent).toContain('Discard');
  });

  it('should render date and day name', async () => {
    const hasDayNumber = textContent.includes('28') || textContent.includes('27');
    expect(hasDayNumber).withContext('Should render day number').toBeTruthy();

    // Check for day name (approximate)
    const hasDayName =
      textContent.includes('Sunday') ||
      textContent.includes('Monday') ||
      textContent.includes('Tuesday') ||
      textContent.includes('Wednesday') ||
      textContent.includes('Thursday') ||
      textContent.includes('Friday') ||
      textContent.includes('Saturday');
    expect(hasDayName).withContext('Should render day name').toBeTruthy();
  });
});
