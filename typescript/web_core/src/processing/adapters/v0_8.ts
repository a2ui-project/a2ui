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
import {InternalComponentPayload, InternalOperation} from '../operations.js';
import {A2uiValidationError} from '../../errors.js';
import {A2uiMessageSchema} from '../../v0_8/schema/server-to-client.js';

function normalizeV08Component(comp: any): InternalComponentPayload {
  if (!comp || typeof comp !== 'object') return comp;
  let componentName = comp.component;
  let props = {...comp};
  delete props.component;
  delete props.id;

  if (comp.component && typeof comp.component === 'object') {
    const keys = Object.keys(comp.component);
    if (keys.length > 0) {
      componentName = keys[0];
      const compProps = comp.component[keys[0]];
      if (compProps && typeof compProps === 'object') {
        props = {...props, ...compProps};
      }
    }
  }

  return {
    id: String(comp.id || ''),
    component: String(componentName || ''),
    ...props,
  };
}

export class V0_8VersionAdapter extends BaseVersionAdapter {
  readonly version: ProtocolVersion = 'v0.8';
  protected readonly schema = A2uiMessageSchema;

  protected override preparePayloadForValidation(
    msgObj: Record<string, unknown>,
  ): Record<string, unknown> {
    const msgWithoutVersion = {...msgObj};
    delete msgWithoutVersion.version;
    return msgWithoutVersion;
  }

  protected extractOperationsFromObject(msgObj: Record<string, unknown>): InternalOperation[] {
    const updateTypes = [
      'beginRendering',
      'surfaceUpdate',
      'dataModelUpdate',
      'deleteSurface',
    ].filter(k => k in msgObj);
    if (updateTypes.length === 0) {
      throw new A2uiValidationError(
        'A2UI Protocol message must contain exactly one update action: beginRendering, surfaceUpdate, dataModelUpdate, or deleteSurface.',
      );
    }
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
          ? cs.components.map(normalizeV08Component)
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
        components: Array.isArray(uc?.components) ? uc.components.map(normalizeV08Component) : [],
      });
    }
    if ('dataModelUpdate' in msgObj) {
      const ud = msgObj.dataModelUpdate as Record<string, unknown>;
      const surfaceId = String(ud?.surfaceId || '');

      if (Array.isArray(ud?.contents)) {
        for (const item of ud.contents as Record<string, unknown>[]) {
          if (item && typeof item === 'object' && typeof item.key === 'string') {
            const val =
              item.valueNumber ??
              item.valueString ??
              item.valueBoolean ??
              item.valueObject ??
              item.valueArray ??
              item.value;
            ops.push({
              type: 'updateDataModel',
              surfaceId,
              path: item.key,
              value: val,
            });
          }
        }
      } else {
        ops.push({
          type: 'updateDataModel',
          surfaceId,
          path: typeof ud?.path === 'string' ? ud.path : undefined,
          value: ud?.value,
        });
      }
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
