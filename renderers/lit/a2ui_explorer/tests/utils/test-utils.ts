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

import {LocalGallery} from '../../src/local-gallery';

import {ReactiveElement} from 'lit';

/**
 * Mounts the <local-gallery> element on the specified example.
 *
 * @param filename The exact filename of the A2UI JSON example (e.g.,
 *                 "02_email-compose.json") as defined in the specification
 *                 catalogs directory.
 *
 * @returns A promise that resolves to the <local-gallery> element after the
 * example has been loaded and rendered.
 */
export async function loadExample(filename: string): Promise<LocalGallery> {
  // Side-effect import to guarantee the <local-gallery> custom element is
  // registered in the browser's customElements registry at test run-time.
  await import('../../src/local-gallery');

  const gallery = document.createElement('local-gallery') as LocalGallery;
  document.body.appendChild(gallery);
  await gallery.updateComplete;

  const index = gallery.demoItems.findIndex(item => item.filename === filename);
  if (index === -1) {
    // Avoid polluting the DOM when an example is not found.
    gallery.remove();
    throw new Error(`Example not found: ${filename}`);
  }

  gallery.selectItem(index);
  await whenSettled(gallery);

  return gallery;
}

/**
 * Awaits the update cycles of a (Lit) element and its children.
 *
 * This is used to wait for the UI to be fully rendered after an interaction.
 *
 * @param root The root element to wait for.
 */
export async function whenSettled(root: ParentNode): Promise<void> {
  // For Lit elements, await updateComplete. This resolves when the element's
  // async update cycle completes.
  // See: https://lit.dev/docs/v1/components/lifecycle/#updatecomplete
  if (root instanceof ReactiveElement) {
    // We need to await updateComplete for the children of root to be ready to
    // be traversed later.
    await root.updateComplete;
  }

  const promises: Promise<void>[] = [];

  for (const child of root.children) {
    promises.push(whenSettled(child));
  }
  if (root instanceof Element && root.shadowRoot) {
    promises.push(whenSettled(root.shadowRoot));
  }

  await Promise.all(promises);
}

/**
 * Recursively walks the DOM tree, crossing open shadow boundaries.
 *
 * This is used to peek into Lit's Shadow DOM elements when testing.
 *
 * @param node The starting node of the DOM subtree to traverse.
 * @param callback A function invoked for every visited DOM Node.
 */
export function walkDeep(node: Node, callback: (node: Node) => void): void {
  callback(node);

  for (const child of node.childNodes) {
    walkDeep(child, callback);
  }
  if (node instanceof Element && node.shadowRoot) {
    walkDeep(node.shadowRoot, callback);
  }
}

/**
 * Retrieves the full textContent of a node, traversing nested Shadow DOMs.
 */
export function getDeepTextContent(root: Node): string {
  let text = '';
  walkDeep(root, node => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    }
  });
  return text;
}

/**
 * Queries all elements matching selector, traversing nested Shadow DOMs.
 */
export function querySelectorAllDeep(root: Node, selector: string): Element[] {
  const results: Element[] = [];
  walkDeep(root, node => {
    if (node !== root && node instanceof Element && node.matches(selector)) {
      results.push(node);
    }
  });
  return results;
}

/**
 * Convenience method to retrieve the first <a2ui-surface> element in root.
 */
export function getSurface(root: Element): HTMLElement {
  const surface = querySelectorAllDeep(root, 'a2ui-surface')[0];
  if (!surface) {
    throw new Error('a2ui-surface not found in root element');
  }
  return surface as HTMLElement;
}

/**
 * Finds a button by its text content, traversing shadow DOMs.
 */
export async function findButtonByText(
  surface: HTMLElement,
  text: string,
): Promise<HTMLButtonElement> {
  const buttons = querySelectorAllDeep(surface, '.a2ui-button') as HTMLButtonElement[];
  const found = buttons.find(b => getDeepTextContent(b).includes(text));
  if (!found) {
    throw new Error(`Button with text "${text}" not found`);
  }
  return found;
}
