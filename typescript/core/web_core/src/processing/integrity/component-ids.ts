/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {A2uiIssue} from '../../schema-engine/types.js';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Checks a v0.8 `surfaceUpdate` for duplicate component ids and for references
 * to component ids the update does not define, and that a `Row`, `Column` or
 * `List` `children` object holds exactly one of `explicitList` and `template`.
 *
 * JSON Schema cannot relate values across array items, so the v0.8 spec states
 * these rules in prose only.
 *
 * @param message A v0.8 server-to-client message that passed schema validation.
 * @returns The issues found; empty when the message is sound.
 */
export function checkV08ComponentIds(message: unknown): A2uiIssue[] {
  if (!isObject(message) || !isObject(message.surfaceUpdate)) return [];
  const components = message.surfaceUpdate.components;
  if (!Array.isArray(components)) return [];
  const base = ['surfaceUpdate', 'components'];
  const issues: A2uiIssue[] = [];

  const ids = new Set<string>();
  components.forEach((c, index) => {
    if (!isObject(c) || typeof c.id !== 'string' || !c.id) return;
    if (ids.has(c.id)) {
      issues.push({path: [...base, index, 'id'], message: `Duplicate component ID found: ${c.id}`});
    }
    ids.add(c.id);
  });

  components.forEach((c, index) => {
    if (!isObject(c) || typeof c.id !== 'string' || !c.id || !isObject(c.component)) return;
    const types = Object.keys(c.component);
    if (types.length !== 1) return;
    const type = types[0];
    const props = c.component[type];
    if (!isObject(props)) return;
    const componentId = c.id;
    const path = [...base, index, 'component', type];
    const checkRefs = (refs: unknown[]) => {
      for (const ref of refs) {
        if (typeof ref === 'string' && ref && !ids.has(ref)) {
          issues.push({
            path,
            message: `Component '${componentId}' references non-existent component ID '${ref}'.`,
          });
        }
      }
    };

    switch (type) {
      case 'Row':
      case 'Column':
      case 'List': {
        const children = props.children;
        if (!isObject(children)) break;
        const explicit = children.explicitList;
        const template = children.template;
        if (Boolean(explicit) === Boolean(template)) {
          issues.push({
            path: [...path, 'children'],
            message: `Component '${componentId}' must have either 'explicitList' or 'template' in children, but not both or neither.`,
          });
        }
        if (Array.isArray(explicit)) checkRefs(explicit);
        if (isObject(template)) checkRefs([template.componentId]);
        break;
      }
      case 'Card':
      case 'Button':
        checkRefs([props.child]);
        break;
      case 'Tabs':
        if (Array.isArray(props.tabItems)) {
          checkRefs(props.tabItems.map(tab => (isObject(tab) ? tab.child : undefined)));
        }
        break;
      case 'Modal':
        checkRefs([props.entryPointChild, props.contentChild]);
        break;
    }
  });
  return issues;
}
