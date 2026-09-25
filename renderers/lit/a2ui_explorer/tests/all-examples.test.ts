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

import {A2uiMessage} from '@a2ui/web_core/v0_9';
import {DemoItem, getDemoItems} from '../src/examples';
import {LocalGallery} from '../src/local-gallery';
import {getSurface, loadExample, querySelectorAllDeep} from './utils/test-utils';

/** The components that render the sandbox proxy in an `<iframe>`. */
const FRAME_COMPONENTS = new Set(['WebAppFrameUrl', 'WebAppFrameSrcdoc', 'McpApp']);

/** Counts the frame components an example declares across its `updateComponents` messages. */
function countFrameComponents(messages: A2uiMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if ('updateComponents' in message) {
      for (const component of message.updateComponents.components) {
        if (FRAME_COMPONENTS.has(component.component)) {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * Renders every example of the generated list once, whichever catalog it comes from, and checks
 * that the surface shows its root component without errors. Frame components must load the
 * sandbox proxy from the explorer's own origin; what the proxy loads inside is not awaited here,
 * so the URL example does not need network access.
 */
describe('Every example', () => {
  const items: DemoItem[] = getDemoItems();
  let gallery: LocalGallery;

  afterEach(() => {
    gallery?.remove();
  });

  it('comes from the basic, iframe or MCP catalog', () => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.catalog, (counts.get(item.catalog) ?? 0) + 1);
    }
    console.log(
      `Iterating ${items.length} examples: ` +
        [...counts].map(([catalog, count]) => `${catalog} ${count}`).join(', '),
    );
    expect([...counts.keys()]).toEqual(['basic', 'iframe', 'mcp']);
  });

  for (const item of items) {
    it(`renders ${item.catalog}/${item.filename}`, async () => {
      gallery = await loadExample(`${item.catalog}/${item.filename}`);
      const surface = getSurface(gallery);

      const root = surface.shadowRoot?.firstElementChild;
      expect(root?.tagName.toLowerCase()).toMatch(/^a2ui-/);
      expect(gallery.mockLogs.filter(log => log.includes('Error on surface'))).toEqual([]);

      const frames = querySelectorAllDeep(surface, 'iframe') as HTMLIFrameElement[];
      expect(frames.length).toBe(countFrameComponents(item.messages));
      for (const frame of frames) {
        expect(frame.src.startsWith(`${window.location.origin}/a2ui-sandbox/`)).toBeTrue();
      }
    });
  }
});
