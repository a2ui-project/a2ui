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

import {TestBed} from '@angular/core/testing';
import {DemoComponent} from '../../demo.component';
import {EXAMPLES_V08, EXAMPLES_V09} from '../../generated/examples-bundle';
import {provideMarkdownRenderer} from '../../../../../src/v0_9/core/markdown';
import {A2UI_VERSION, Version} from '../../types';

export {Version};

/**
 * Helper function to load an example in the DemoComponent for testing.
 * Resolves after the example is selected and initial async rendering has time to complete.
 */
export async function loadExample(exampleName: string, version: Version = Version.V0_9) {
  await TestBed.configureTestingModule({
    imports: [DemoComponent],
    providers: [
      provideMarkdownRenderer(),
      {
        provide: A2UI_VERSION,
        useValue: version,
      },
    ],
  });

  const fixture = TestBed.createComponent(DemoComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  const examples = version === Version.V0_9 ? EXAMPLES_V09 : EXAMPLES_V08;
  let example = examples.find(ex => ex.name === exampleName);

  if (version === Version.V0_8 && !example) {
    example =
      examples.find(ex => ex.name === `${exampleName} (basic)`) ||
      examples.find(ex => ex.name === `${exampleName} (minimal)`);
  }

  expect(example).withContext(`Example not found: ${exampleName}`).toBeTruthy();

  component.selectExample(example!);
  fixture.detectChanges();

  await whenSettled();

  return fixture;
}

/**
 * Returns a promise that resolves when the renderer is settled.
 */
async function whenSettled(): Promise<void> {
  // In a zoneless application, we cannot rely on NgZone.onStable.
  // Yielding to the macrotask queue ensures that all pending microtasks
  // (like Preact signal listeners and Angular CD cycles) are executed.
  const MACROTASKS_TO_FLUSH = 20;

  for (let i = 0; i < MACROTASKS_TO_FLUSH; i++) {
    await wait(0);
  }
}

/**
 * Helper function to wait for a given number of milliseconds.
 */
export function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getCanvas(): HTMLDivElement {
  return document.querySelector('.canvas-frame')!;
}

/**
 * Helper function to wait for a condition to become true.
 * Returns a promise that resolves to true if the condition is met within the timeout, or false otherwise.
 * Compatible with Jasmine because it uses standard boolean checks instead of throwing expectations inside the loop.
 * Supports only synchronous condition checks.
 */
export async function waitForCondition(
  condition: () => boolean,
  timeout = 1000,
  interval = 50,
): Promise<boolean> {
  const start = performance.now();
  while (true) {
    if (condition()) {
      return true;
    }
    if (performance.now() - start > timeout) {
      return false;
    }
    await wait(interval);
  }
}
