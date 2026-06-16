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
describe('Example: Shipping Status', () => {
  let container: HTMLDivElement;
  let actionSpy: jasmine.Spy;
  let surface: HTMLElement;

  afterEach(async () => {
    await cleanup();
  });
  let textContent: string;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('onAction');
    container = await loadExample('21_shipping-status.json', actionSpy);
    surface = getSurface(container);
    textContent = surface.textContent || '';
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Package Status');
    expect(textContent).toContain('Tracking: 1Z999AA10123456784');
    expect(textContent).toContain('Order Placed');
    expect(textContent).toContain('Shipped');
    expect(textContent).toContain('Out for Delivery');
    expect(textContent).toContain('Delivered');
    expect(textContent).toContain('Estimated delivery: Today by 8 PM');
  });

  it('should render icons', async () => {
    expect(textContent).toContain('info');
    expect(textContent).toContain('check');
    expect(textContent).toContain('send');
    expect(textContent).toContain('calendar_today');
  });
});
