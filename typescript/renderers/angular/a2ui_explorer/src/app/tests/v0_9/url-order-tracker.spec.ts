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

describe('Example: URL Order Tracker', () => {
  let canvas: HTMLElement;
  let appRef: ApplicationRef;

  beforeEach(async () => {
    await loadExample({
      name: 'URL order tracker',
      version: Version.V0_9,
      useUniversalComponents: true,
    });
    appRef = TestBed.inject(ApplicationRef);
    appRef.tick();
    canvas = getCanvas();
    const ready = await waitForCondition(() => {
      appRef.tick();
      return (canvas.textContent ?? '').includes('Status: 1 processing, 2 shipped');
    }, 3000);
    expect(ready).withContext('Expected initial order tracker summary to render').toBeTrue();
  });

  it('renders the sandboxed URL order tracker and writes the initial status summary', () => {
    const textContent = canvas.textContent ?? '';
    expect(textContent).toContain('Order tracker');
    expect(textContent).toContain('Status: 1 processing, 2 shipped');
    expect(canvas.querySelector('a2ui-web-app-frame-url iframe')).toBeTruthy();
  });

  it('recomputes the status summary when an order status is updated to delivered', async () => {
    const dataTextarea = document.querySelector('.data-section textarea') as HTMLTextAreaElement;
    expect(dataTextarea).toBeTruthy();

    dataTextarea.value = dataTextarea.value.replace('"shipped"', '"delivered"');
    dataTextarea.dispatchEvent(new Event('input', {bubbles: true}));

    const updated = await waitForCondition(() => {
      appRef.tick();
      return (canvas.textContent ?? '').includes('Status: 1 processing, 1 shipped, 1 delivered');
    }, 3000);
    expect(updated).withContext('Expected updated order tracker summary to render').toBeTrue();
  });
});
