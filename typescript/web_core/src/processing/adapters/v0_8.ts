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

import {ProtocolVersion, VersionAdapter} from './base.js';
import {InternalComponentPayload, InternalOperation} from '../operations.js';
import {A2uiValidationError} from '../../errors.js';

export class V0_8VersionAdapter implements VersionAdapter {
  readonly version: ProtocolVersion = 'v0.8';

  extractOperations(payload: unknown): InternalOperation[] {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload)) {
      return payload.flatMap(item => this.extractOperations(item));
    }
    const msgObj = payload as Record<string, unknown>;
    if (Array.isArray(msgObj.messages)) {
      return this.extractOperations(msgObj.messages);
    }

    const updateTypes = [
      'beginRendering',
      'surfaceUpdate',
      'dataModelUpdate',
      'deleteSurface',
    ].filter(k => k in msgObj);
    if (updateTypes.length > 1) {
      throw new A2uiValidationError(
        `Message contains multiple update types: ${updateTypes.join(', ')}.`,
      );
    }

    const ops: InternalOperation[] = [];
    if ('beginRendering' in msgObj) {
      const cs = msgObj.beginRendering as Record<string, unknown>;
      ops.push({
        type: 'createSurface',
        surfaceId: String(cs?.surfaceId || ''),
        catalogId: typeof cs?.catalogId === 'string' ? cs.catalogId : undefined,
        theme: cs?.theme ?? cs?.styles,
        sendDataModel: Boolean(cs?.sendDataModel),
        components: Array.isArray(cs?.components)
          ? (cs.components as InternalComponentPayload[])
          : undefined,
        dataModel:
          cs?.dataModel && typeof cs.dataModel === 'object' && !Array.isArray(cs.dataModel)
            ? (cs.dataModel as Record<string, unknown>)
            : undefined,
      });
    }
    if ('surfaceUpdate' in msgObj) {
      const uc = msgObj.surfaceUpdate as Record<string, unknown>;
      ops.push({
        type: 'updateComponents',
        surfaceId: String(uc?.surfaceId || ''),
        components: Array.isArray(uc?.components) ? uc.components : [],
      });
    }
    if ('dataModelUpdate' in msgObj) {
      const ud = msgObj.dataModelUpdate as Record<string, unknown>;
      ops.push({
        type: 'updateDataModel',
        surfaceId: String(ud?.surfaceId || ''),
        path: typeof ud?.path === 'string' ? ud.path : undefined,
        value: ud?.value,
      });
    }
    if ('deleteSurface' in msgObj) {
      const ds = msgObj.deleteSurface as Record<string, unknown>;
      ops.push({
        type: 'deleteSurface',
        surfaceId: String(ds?.surfaceId || ''),
      });
    }
    return ops;
  }
}
