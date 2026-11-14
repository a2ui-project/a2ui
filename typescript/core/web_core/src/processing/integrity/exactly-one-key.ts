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

const V08_ACTIONS = ['beginRendering', 'surfaceUpdate', 'dataModelUpdate', 'deleteSurface'];
const V08_VALUE_KEYS = ['valueString', 'valueNumber', 'valueBoolean', 'valueMap'];

function checkDataEntries(entries: unknown, path: (string | number)[], issues: A2uiIssue[]): void {
  if (!Array.isArray(entries)) return;
  entries.forEach((entry, index) => {
    if (!isObject(entry)) return;
    const count = V08_VALUE_KEYS.filter(k => entry[k] !== undefined).length;
    if (count !== 1) {
      issues.push({
        path: [...path, index],
        message: `Value map item must have exactly one value property (valueString, valueNumber, valueBoolean, valueMap), found ${count}.`,
      });
    }
    checkDataEntries(entry.valueMap, [...path, index, 'valueMap'], issues);
  });
}

/**
 * Checks the v0.8 "exactly one" rules the v0.8 spec states in prose but its
 * JSON Schema does not encode: a message holds exactly one action, a component
 * wrapper holds exactly one component type key, and a data entry holds exactly
 * one `value*` property.
 *
 * @param message A v0.8 server-to-client message that passed schema validation.
 * @returns The issues found; empty when the message is sound.
 */
export function checkV08ExactlyOneKey(message: unknown): A2uiIssue[] {
  if (!isObject(message)) return [];
  const issues: A2uiIssue[] = [];
  const actions = V08_ACTIONS.filter(k => message[k] !== undefined);
  if (actions.length !== 1) {
    issues.push({
      path: [],
      message:
        'A2UI Protocol message must have exactly one of: surfaceUpdate, dataModelUpdate, beginRendering, deleteSurface.',
    });
  }
  const su = message.surfaceUpdate;
  if (isObject(su) && Array.isArray(su.components)) {
    su.components.forEach((c, index) => {
      if (isObject(c) && isObject(c.component) && Object.keys(c.component).length !== 1) {
        issues.push({
          path: ['surfaceUpdate', 'components', index, 'component'],
          message:
            "A wrapper object that MUST contain exactly one key, which is the name of the component type (e.g., 'Heading').",
        });
      }
    });
  }
  const dm = message.dataModelUpdate;
  if (isObject(dm)) checkDataEntries(dm.contents, ['dataModelUpdate', 'contents'], issues);
  return issues;
}
