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

import {ApplicationRef} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {getCanvas, loadExample, waitForCondition, Version} from '../utils';

describe('Example: MCP App Order Summary', () => {
  let canvas: HTMLElement;
  let appRef: ApplicationRef;

  beforeEach(async () => {
    await loadExample({
      name: 'MCP App order summary',
      version: Version.V0_9,
      useUniversalComponents: true,
    });
    appRef = TestBed.inject(ApplicationRef);
    appRef.tick();
    canvas = getCanvas();
    const ready = await waitForCondition(() => {
      appRef.tick();
      return (
        (document.querySelector('.events-section')?.textContent ?? '').includes('get_order') &&
        (canvas.textContent ?? '').includes('Total due: $90.00')
      );
    }, 3000);
    expect(ready).withContext('Expected MCP app to dispatch get_order action').toBeTrue();
  });

  it('renders the sandboxed MCP app and dispatches the get_order tool call as an action', () => {
    const textContent = canvas.textContent ?? '';
    expect(textContent).toContain('Discount code');
    expect(textContent).toContain('Total due: $90.00');
    expect(canvas.querySelector('a2ui-mcp-app iframe')).toBeTruthy();
    expect(document.querySelector('.events-section')?.textContent).toContain('get_order');
  });

  it('applies the discount code from the text field', async () => {
    const discountInput = canvas.querySelector('input[placeholder="SAVE10"]') as HTMLInputElement;
    expect(discountInput).toBeTruthy();
    discountInput.value = 'SAVE10';
    discountInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));

    const discounted = await waitForCondition(() => {
      appRef.tick();
      return (canvas.textContent ?? '').includes('Total due: $81.00');
    }, 3000);
    expect(discounted).withContext('Expected discounted total of $81.00 to render').toBeTrue();
  });

  it('lists all 3 MCP App examples in the sidebar', () => {
    const sidebarText = document.querySelector('.example-list')?.textContent ?? '';
    expect(sidebarText).toContain('MCP App order summary');
    expect(sidebarText).toContain('MCP App sheet music');
    expect(sidebarText).toContain('MCP App 3D geometry');
  });
});
