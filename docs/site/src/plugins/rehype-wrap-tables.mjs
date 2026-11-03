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

function walk(node, parent, index) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'element' && node.tagName === 'table') {
    if (
      parent &&
      !(parent.tagName === 'div' && parent.properties?.className?.includes('table-wrapper'))
    ) {
      const wrapper = {
        type: 'element',
        tagName: 'div',
        properties: {className: ['table-wrapper']},
        children: [node],
      };
      parent.children[index] = wrapper;
      return;
    }
  }
  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i], node, i);
    }
  }
}

/**
 * Rehype plugin to automatically wrap all <table> elements in <div class="table-wrapper">
 * ensuring holistic responsive overflow-x scrolling, outer card styling, and proper cell padding.
 */
export function rehypeWrapTables() {
  return function transformer(tree) {
    walk(tree, null, null);
  };
}
