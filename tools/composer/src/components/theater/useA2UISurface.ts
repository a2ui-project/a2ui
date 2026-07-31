/* eslint-disable @typescript-eslint/no-explicit-any */ // TODO: remediate legacy any types
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

import {useMemo} from 'react';
import {transpileToV0_8} from '@/lib/transcoder';
import type {A2UIComponent} from '@/types/widget';

export interface A2UISurfaceState {
  root: string;
  components: A2UIComponent[];
  data: Record<string, any>;
}

/**
 * Transform a stream of A2UI messages (v0.8 or v0.9) into
 * the props format that A2UIViewer expects.
 */
export function useA2UISurface(messages: any[]): A2UISurfaceState {
  return useMemo(() => {
    let root = 'root';
    const componentsMap = new Map<string, A2UIComponent>();
    let data: Record<string, any> = {};

    for (const msg of messages) {
      if (!msg) continue;

      // Transpile v0.9 -> v0.8 (v0.8 passes through unchanged)
      const v0_8msg = transpileToV0_8(msg);

      // Handle beginRendering (v0.8)
      if (v0_8msg.beginRendering) {
        root = v0_8msg.beginRendering.root || 'root';
      }

      // Handle surfaceUpdate (v0.8) — components already in { id, component: { Type: props } } format
      if (v0_8msg.surfaceUpdate) {
        const newComponents = v0_8msg.surfaceUpdate.components || [];
        for (const comp of newComponents) {
          if (comp.id && comp.component) {
            componentsMap.set(comp.id, {
              id: comp.id,
              component: comp.component,
            });
          }
        }
      }

      // Handle dataModelUpdate (v0.8)
      if (v0_8msg.dataModelUpdate) {
        const contents = v0_8msg.dataModelUpdate.contents;
        if (contents) {
          // contents can be an array of ValueMap objects or a plain object
          if (Array.isArray(contents)) {
            for (const item of contents) {
              if (item.key !== undefined) {
                // ValueMap format: { key, valueString?, valueNumber?, valueBoolean?, valueMap? }
                data[item.key] = extractValueMapValue(item);
              } else {
                // Plain object
                data = {...data, ...item};
              }
            }
          } else if (typeof contents === 'object') {
            data = {...data, ...contents};
          }
        }
      }
    }

    return {
      root,
      components: Array.from(componentsMap.values()),
      data,
    };
  }, [messages]);
}

/**
 * Extract a JavaScript value from a ValueMap entry.
 */
function extractValueMapValue(item: any): any {
  if (item.valueString !== undefined) return item.valueString;
  if (item.valueNumber !== undefined) return item.valueNumber;
  if (item.valueBoolean !== undefined) return item.valueBoolean;
  if (item.valueMap !== undefined) {
    // Recursive: array of ValueMap -> object
    const obj: Record<string, any> = {};
    for (const child of item.valueMap) {
      obj[child.key] = extractValueMapValue(child);
    }
    return obj;
  }
  return null;
}
