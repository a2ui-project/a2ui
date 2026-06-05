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

import {getDeepTextContent, querySelectorAllDeep, walkDeep} from './test-utils';

describe('test-utils', () => {
  describe('walkDeep', () => {
    it('should traverse nested shadow DOMs', () => {
      const container = document.createElement('div');
      container.id = 'container';

      const host1 = document.createElement('div');
      host1.id = 'host1';
      container.appendChild(host1);
      const shadow1 = host1.attachShadow({mode: 'open'});
      const inner1 = document.createElement('div');
      inner1.id = 'inner1';
      shadow1.appendChild(inner1);

      const host2 = document.createElement('div');
      host2.id = 'host2';
      inner1.appendChild(host2);
      const shadow2 = host2.attachShadow({mode: 'open'});
      const inner2 = document.createElement('div');
      inner2.id = 'inner2';
      shadow2.appendChild(inner2);

      const visitedIds: string[] = [];
      walkDeep(container, node => {
        if (node instanceof Element && node.id) {
          visitedIds.push(node.id);
        }
      });

      expect(visitedIds).toEqual(['container', 'host1', 'inner1', 'host2', 'inner2']);
    });

    it('should preserve document order when interleaving light DOM nodes and shadow DOMs', () => {
      const container = document.createElement('div');
      container.id = 'container';

      const host1 = document.createElement('div');
      host1.id = 'host1';
      container.appendChild(host1);
      const shadow1 = host1.attachShadow({mode: 'open'});
      const inner1 = document.createElement('div');
      inner1.id = 'inner1';
      shadow1.appendChild(inner1);

      const middle = document.createElement('div');
      middle.id = 'middle';
      container.appendChild(middle);

      const host2 = document.createElement('div');
      host2.id = 'host2';
      container.appendChild(host2);
      const shadow2 = host2.attachShadow({mode: 'open'});
      const inner2 = document.createElement('div');
      inner2.id = 'inner2';
      shadow2.appendChild(inner2);

      const visitedIds: string[] = [];
      walkDeep(container, node => {
        if (node instanceof Element && node.id) {
          visitedIds.push(node.id);
        }
      });

      expect(visitedIds).toEqual(['container', 'host1', 'inner1', 'middle', 'host2', 'inner2']);
    });
  });

  describe('getDeepTextContent', () => {
    it('should traverse shadow DOM and return its text', () => {
      const container = document.createElement('div');
      container.appendChild(document.createTextNode('Light text '));

      const shadowHost = document.createElement('div');
      container.appendChild(shadowHost);

      const shadow = shadowHost.attachShadow({mode: 'open'});
      shadow.innerHTML = 'Shadow text <span>nested shadow text</span>';

      expect(getDeepTextContent(container)).toBe('Light text Shadow text nested shadow text');
    });
  });

  describe('querySelectorAllDeep', () => {
    it('should find elements in the light DOM', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <span id="target1" class="target">1</span>
        <div>
          <span id="target2" class="target">2</span>
        </div>
      `;
      const matches = querySelectorAllDeep(container, '.target');
      expect(matches.length).toBe(2);
      expect(matches[0].id).toBe('target1');
      expect(matches[1].id).toBe('target2');
    });

    it('should find elements inside shadow DOM', () => {
      const container = document.createElement('div');

      const host = document.createElement('div');
      container.appendChild(host);
      const shadow = host.attachShadow({mode: 'open'});
      shadow.innerHTML = `
        <span id="target1" class="target">Shadow 1</span>
        <div>
          <span id="target2" class="target">Shadow 2</span>
        </div>
      `;

      const matches = querySelectorAllDeep(container, '.target');
      expect(matches.length).toBe(2);
      expect(matches.map(m => m.id)).toEqual(['target1', 'target2']);
    });

    it('should not match the root element itself, to match querySelectorAll behavior', () => {
      const container = document.createElement('div');
      container.className = 'target';

      const child = document.createElement('div');
      child.className = 'target';
      container.appendChild(child);

      const matches = querySelectorAllDeep(container, '.target');
      expect(matches.length).toBe(1);
      expect(matches[0]).toBe(child);
    });
  });
});
