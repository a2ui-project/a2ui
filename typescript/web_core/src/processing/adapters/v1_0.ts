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

import {BaseVersionAdapter, ProtocolVersion} from './base.js';
import {
  InternalComponentPayload,
  InternalOperation,
  INTERNAL_OPERATION_TYPES,
} from '../operations.js';
import {AgentToRendererMessageSchema} from '../../v1_0/schema/agent-to-renderer.js';

/**
 * Protocol version adapter for specification v1.0.
 */
export class V1Point0Adapter extends BaseVersionAdapter {
  readonly version: ProtocolVersion = 'v1.0';
  protected readonly schema = AgentToRendererMessageSchema;

  protected getNativeActionKeys(): string[] {
    return [...INTERNAL_OPERATION_TYPES];
  }

  protected extractOperationsFromObject(msgObj: Record<string, unknown>): InternalOperation[] {
    const ops: InternalOperation[] = [];
    if ('createSurface' in msgObj) {
      const cs = msgObj.createSurface as Record<string, unknown>;
      ops.push({
        type: 'createSurface',
        surfaceId: String(cs?.surfaceId || ''),
        catalogId: typeof cs?.catalogId === 'string' ? cs.catalogId : undefined,
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
    if ('updateComponents' in msgObj) {
      const uc = msgObj.updateComponents as Record<string, unknown>;
      ops.push({
        type: 'updateComponents',
        surfaceId: String(uc?.surfaceId || ''),
        components: Array.isArray(uc?.components)
          ? (uc.components as InternalComponentPayload[])
          : [],
      });
    }
    if ('updateDataModel' in msgObj) {
      const ud = msgObj.updateDataModel as Record<string, unknown>;
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
    if ('callRendererFunction' in msgObj) {
      const crf = msgObj.callRendererFunction as Record<string, unknown>;
      const cf = (crf?.callFunction || {}) as Record<string, unknown>;
      ops.push({
        type: 'callRendererFunction',
        functionCallId: String(crf?.functionCallId || ''),
        call: String(cf?.call || ''),
        version: this.version,
        catalogId: typeof cf?.catalogId === 'string' ? cf.catalogId : undefined,
        args:
          cf?.args && typeof cf.args === 'object' && !Array.isArray(cf.args)
            ? (cf.args as Record<string, unknown>)
            : {},
      });
    }
    if ('agentFunctionResponse' in msgObj) {
      const afr = msgObj.agentFunctionResponse as Record<string, unknown>;
      ops.push({
        type: 'agentFunctionResponse',
        functionCallId: String(afr?.functionCallId || ''),
        version: this.version,
        value: afr?.value,
        error:
          afr?.error && typeof afr.error === 'object'
            ? (afr.error as {code: string; message: string})
            : undefined,
      });
    }
    return ops;
  }
}
