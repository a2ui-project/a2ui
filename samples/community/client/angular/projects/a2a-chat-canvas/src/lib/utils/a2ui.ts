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
import * as Types from '@a2ui/web_core/types/types';
import {isA2aDataPart} from './type-guards';

/**
 * Extracts A2UI ServerToClientMessages from an array of A2A Parts.
 * It filters for parts that are A2A DataParts and checks for the presence of A2UI message keys
 * (beginRendering, surfaceUpdate, dataModelUpdate, deleteSurface).
 *
 * @param parts An array of A2A Parts.
 * @returns An array of A2UI Types.ServerToClientMessage objects.
 */
export function extractA2uiDataParts(parts: Part[]) {
  return parts.reduce<any[]>((messages, part) => {
    if (isA2aDataPart(part)) {
      if (part.data && typeof part.data === 'object') {
        if ('createSurface' in part.data) {
          messages.push({
            createSurface: part.data['createSurface'],
          });
        } else if ('updateComponents' in part.data) {
          messages.push({
            updateComponents: part.data['updateComponents'],
          });
        } else if ('updateDataModel' in part.data) {
          messages.push({
            updateDataModel: part.data['updateDataModel'],
          });
        } else if ('beginRendering' in part.data) {
          messages.push({
            beginRendering: part.data['beginRendering'],
          });
        } else if ('surfaceUpdate' in part.data) {
          messages.push({
            surfaceUpdate: part.data['surfaceUpdate'],
          });
        } else if ('dataModelUpdate' in part.data) {
          messages.push({
            dataModelUpdate: part.data['dataModelUpdate'],
          });
        } else if ('deleteSurface' in part.data) {
          messages.push({
            deleteSurface: part.data['deleteSurface'],
          });
        }
      }
    }
    return messages;
  }, []);
}
