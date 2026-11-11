/* eslint-disable @typescript-eslint/no-explicit-any */ // TODO: remediate legacy any types
/**
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

import {useMemo} from 'react';
import type {A2UIComponent} from '@/types/widget';

export interface A2UISurfaceState {
  root: string;
  components: A2UIComponent[];
  data: Record<string, any>;
}

function applyUpdateDataModel(
  data: Record<string, any>,
  update: {path?: string; value?: any},
): Record<string, any> {
  const {path, value} = update;
  if (!path || path === '/') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return {...data, ...value};
    }
    return data;
  }

  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return data;

  const next: Record<string, any> = structuredClone(data);
  let curr: any = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (curr[key] === undefined || curr[key] === null || typeof curr[key] !== 'object') {
      const nextKey = parts[i + 1]!;
      curr[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    curr = curr[key];
  }

  const lastKey = parts[parts.length - 1]!;
  if (value === undefined) {
    if (Array.isArray(curr) && /^\d+$/.test(lastKey)) {
      curr.splice(Number(lastKey), 1);
    } else {
      delete curr[lastKey];
    }
  } else {
    curr[lastKey] = value;
  }

  return next;
}

/**
 * Transform a stream of A2UI v0.9 messages into
 * the props format that A2UIViewer expects.
 */
export function useA2UISurface(messages: any[]): A2UISurfaceState {
  return useMemo(() => {
    const root = 'root';
    const componentsMap = new Map<string, A2UIComponent>();
    let data: Record<string, any> = {};

    for (const msg of messages) {
      if (!msg) continue;

      if (msg.createSurface || msg.deleteSurface) {
        componentsMap.clear();
        data = {};
      }

      if (msg.updateComponents) {
        const newComponents = msg.updateComponents.components || [];
        for (const comp of newComponents) {
          if (comp.id && comp.component) {
            componentsMap.set(comp.id, comp);
          }
        }
      }

      if (msg.updateDataModel) {
        data = applyUpdateDataModel(data, msg.updateDataModel);
      }
    }

    return {
      root,
      components: Array.from(componentsMap.values()),
      data,
    };
  }, [messages]);
}
