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

describe('Example: Srcdoc Tip Calculator', () => {
  let canvas: HTMLElement;
  let appRef: ApplicationRef;

  beforeEach(async () => {
    await loadExample({
      name: 'Srcdoc tip calculator',
      version: Version.V0_9,
      useUniversalComponents: true,
    });
    appRef = TestBed.inject(ApplicationRef);
    appRef.tick();
    canvas = getCanvas();
    const ready = await waitForCondition(() => {
      appRef.tick();
      return (canvas.textContent ?? '').includes('Total to pay: $75.52');
    }, 3000);
    expect(ready).withContext('Expected initial tip calculator totals to render').toBeTrue();
  });

  it('renders the sandboxed tip calculator and computes initial totals from seeded data', () => {
    const textContent = canvas.textContent ?? '';
    expect(textContent).toContain('Tip calculator');
    expect(textContent).toContain('Bill amount');
    expect(textContent).toContain('Tip percent');
    expect(textContent).toContain('Total to pay: $75.52');
    expect(canvas.querySelector('a2ui-web-app-frame-srcdoc iframe')).toBeTruthy();
  });

  it('recomputes totals when the host bill text field is updated', async () => {
    const billInput = canvas.querySelector('input') as HTMLInputElement;
    expect(billInput).toBeTruthy();

    billInput.value = '100';
    billInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));

    const updated = await waitForCondition(() => {
      appRef.tick();
      return (canvas.textContent ?? '').includes('Total to pay: $118.00');
    }, 3000);
    expect(updated).withContext('Expected updated tip calculator totals to render').toBeTrue();
  });
});
