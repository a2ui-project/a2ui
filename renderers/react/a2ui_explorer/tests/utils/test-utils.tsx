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

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {App} from '../../src/App';
import type {A2uiClientAction} from '@a2ui/web_core/v0_9';

/** Reference to the active React root instance used to render the App. */
let activeRoot: Root | null = null;

const TEST_CONTAINER_ID = 'test-container';

/**
 * Mounts the <App> component preloaded with the specified example.
 *
 * @param filename The exact filename of the A2UI JSON example (e.g., "02_email-compose.json").
 * @param onAction Optional callback to capture action dispatch events.
 * @returns A promise that resolves to the container element.
 */
export async function loadExample(
  filename: string,
  onAction?: (action: A2uiClientAction) => void,
): Promise<HTMLDivElement> {
  // Clean up previous runs
  await cleanup();

  const container = document.createElement('div');
  container.id = TEST_CONTAINER_ID;
  document.body.appendChild(container);

  // Map filename (e.g. "02_email-compose.json") to id (e.g. "02_email-compose")
  const id = filename.replace('.json', '');

  const root = createRoot(container);
  activeRoot = root;

  await act(async () => {
    root.render(<App initialExampleId={id} onAction={onAction} />);
    await whenSettled();
  });

  return container;
}

/**
 * Cleans up mounted React component and container from DOM.
 */
export async function cleanup() {
  if (activeRoot) {
    try {
      await act(async () => {
        activeRoot?.unmount();
        await whenSettled();
      });
    } finally {
      activeRoot = null;
    }
  }
  document.getElementById(TEST_CONTAINER_ID)?.remove();
}

/**
 * Awaits React state updates and yields thread execution to let async side-effects settle.
 */
export async function whenSettled(): Promise<void> {
  // Yield thread execution to let any asynchronous message processor cycles, Preact signals
  // effects, or event callbacks complete and render before proceeding.
  // Originally we had this inside an `act` block, but that breaks some of our
  // tests. This function needs to be called from within `act` blocks, and those
  // can't be nested.
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Finds a button by its text content inside the given container.
 */
export function findButtonByText(root: Element, text: string): HTMLButtonElement {
  const buttons = Array.from(root.querySelectorAll('button'));
  const found = buttons.find(b => b.textContent?.includes(text));
  if (!found) {
    throw new Error(`Button with text "${text}" not found`);
  }
  return found;
}

/**
 * Convenience method to retrieve the first rendered surface container element in root.
 */
export function getSurface(root: Element): HTMLElement {
  const surface = root.querySelector('[class*="surfaceContainer"]');
  if (!surface) {
    throw new Error('surfaceContainer not found in root element');
  }
  return surface as HTMLElement;
}
