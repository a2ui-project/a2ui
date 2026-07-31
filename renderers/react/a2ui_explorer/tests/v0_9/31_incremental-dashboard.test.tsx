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
describe('Example: Incremental Dashboard', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('31_incremental-dashboard.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render header', async () => {
    expect(textContent).toContain('System Dashboard');
  });

  it('should render final state content', async () => {
    expect(textContent).toContain('Analytics are ready.');
    expect(textContent).toContain('System boot complete.');
    expect(textContent).toContain('All services healthy.');
    expect(textContent).toContain('Waiting for user input.');

    // Verify that loading texts are gone
    expect(textContent).not.toContain('Loading analytics...');
    expect(textContent).not.toContain('Loading logs...');
  });
});
