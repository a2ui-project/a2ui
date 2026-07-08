/*
 * Copyright 2025 Google LLC
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

import {Part} from '@a2a-js/sdk';
import {ServerToClientMessage as ServerToClientMessageV08} from '@a2ui/web_core/v0_8';
import {A2uiMessage as A2uiMessageV09} from '@a2ui/web_core/v0_9';
import {isA2aDataPart} from './type-guards';

/**
 * Extracts A2UI ServerToClientMessages from an array of A2A Parts.
 * It filters for parts that are A2A DataParts and checks for the presence of A2UI message keys
 * (beginRendering, surfaceUpdate, dataModelUpdate, deleteSurface).
 *
 * @param parts An array of A2A Parts.
 * @returns An array of A2UI Message objects (v0.8 or v0.9).
 */
export function extractA2uiDataParts(parts: Part[]): (ServerToClientMessageV08 | A2uiMessageV09)[] {
  return parts.reduce<(ServerToClientMessageV08 | A2uiMessageV09)[]>((messages, part) => {
    if (isA2aDataPart(part)) {
      if (part.data && typeof part.data === 'object') {
        const data = part.data as Record<string, unknown>;

        if ('createSurface' in data) {
          messages.push({
            version: 'v0.9',
            createSurface: data['createSurface'],
          } as A2uiMessageV09);
        } else if ('updateComponents' in data) {
          messages.push({
            version: 'v0.9',
            updateComponents: data['updateComponents'],
          } as A2uiMessageV09);
        } else if ('updateDataModel' in data) {
          messages.push({
            version: 'v0.9',
            updateDataModel: data['updateDataModel'],
          } as A2uiMessageV09);
        } else if ('beginRendering' in data) {
          messages.push({
            beginRendering: data['beginRendering'],
          } as ServerToClientMessageV08);
        } else if ('surfaceUpdate' in data) {
          messages.push({
            surfaceUpdate: data['surfaceUpdate'],
          } as ServerToClientMessageV08);
        } else if ('dataModelUpdate' in data) {
          messages.push({
            dataModelUpdate: data['dataModelUpdate'],
          } as ServerToClientMessageV08);
        } else if ('deleteSurface' in data) {
          if (data['version'] === 'v0.9') {
            messages.push({
              version: 'v0.9',
              deleteSurface: data['deleteSurface'],
            } as A2uiMessageV09);
          } else {
            messages.push({
              deleteSurface: data['deleteSurface'],
            } as ServerToClientMessageV08);
          }
        }
      }
    }
    return messages;
  }, []);
}
