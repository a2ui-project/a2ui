// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  AgentToRendererMessageType,
  RendererToAgentMessageType,
  AgentToRendererListWrapperType,
  AgentToRendererMessageListType,
} from '../v1_0/proto/index.js';

const STD_COMPONENT_KEYS = new Set([
  'id',
  'component',
  'catalogId',
  'accessibility',
  'metadata',
  'properties',
]);

/**
 * Converts a JavaScript value into a google.protobuf.Value representation.
 */
export function jsValueToProtoValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) {
    return {nullValue: 0};
  }
  if (typeof val === 'number') {
    return {numberValue: val};
  }
  if (typeof val === 'string') {
    return {stringValue: val};
  }
  if (typeof val === 'boolean') {
    return {boolValue: val};
  }
  if (Array.isArray(val)) {
    return {listValue: {values: val.map(jsValueToProtoValue)}};
  }
  if (typeof val === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      fields[k] = jsValueToProtoValue(v);
    }
    return {structValue: {fields}};
  }
  return {stringValue: String(val)};
}

export function protoValueToJsValue(protoVal: unknown): unknown {
  if (!protoVal || typeof protoVal !== 'object') {
    return protoVal;
  }
  const obj = protoVal as Record<string, unknown>;
  if ('nullValue' in obj) {
    return null;
  }
  if ('numberValue' in obj) {
    return obj.numberValue;
  }
  if ('stringValue' in obj) {
    return obj.stringValue;
  }
  if ('boolValue' in obj) {
    return obj.boolValue;
  }
  if ('listValue' in obj && obj.listValue && typeof obj.listValue === 'object') {
    const listObj = obj.listValue as Record<string, unknown>;
    const vals = Array.isArray(listObj.values) ? listObj.values : [];
    return vals.map(protoValueToJsValue);
  }
  if ('structValue' in obj && obj.structValue && typeof obj.structValue === 'object') {
    const structObj = obj.structValue as Record<string, unknown>;
    const fields = (structObj.fields as Record<string, unknown>) || {};
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = protoValueToJsValue(v);
    }
    return res;
  }
  if ('fields' in obj && obj.fields && typeof obj.fields === 'object') {
    const fields = obj.fields as Record<string, unknown>;
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = protoValueToJsValue(v);
    }
    return res;
  }
  return protoVal;
}

/**
 * Normalizes flat A2UI component dictionaries into Protobuf Component message format.
 */
function normalizeComponentForProto(comp: Record<string, unknown>): Record<string, unknown> {
  if (!comp || typeof comp !== 'object') return comp;
  const extraKeys = Object.keys(comp).filter(k => !STD_COMPONENT_KEYS.has(k));
  if (extraKeys.length > 0) {
    const normalized: Record<string, unknown> = {};
    const props: Record<string, unknown> = {
      ...((comp.properties as Record<string, unknown>) || {}),
    };
    for (const key of Object.keys(comp)) {
      if (STD_COMPONENT_KEYS.has(key)) {
        normalized[key] = comp[key];
      } else {
        props[key] = comp[key];
      }
    }
    // Convert properties into google.protobuf.Struct fields
    const structFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      structFields[k] = jsValueToProtoValue(v);
    }
    normalized.properties = {fields: structFields};
    return normalized;
  }
  return comp;
}

/**
 * Flattens Protobuf Component.properties back into top-level component properties.
 */
function denormalizeComponentFromProto(comp: Record<string, unknown>): Record<string, unknown> {
  if (!comp || typeof comp !== 'object') return comp;
  const compFlat = {...comp};
  if ('properties' in compFlat && compFlat.properties && typeof compFlat.properties === 'object') {
    const rawProps = compFlat.properties;
    delete compFlat.properties;
    const flatProps = protoValueToJsValue(rawProps) as Record<string, unknown>;
    if (flatProps && typeof flatProps === 'object') {
      Object.assign(compFlat, flatProps);
    }
  }
  return compFlat;
}

/**
 * Normalizes an AgentToRenderer payload for Protobuf encoding.
 */
export function normalizeAgentPayloadForProto(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const norm = {...payload};

  if (norm.createSurface && typeof norm.createSurface === 'object') {
    const cs = {...(norm.createSurface as Record<string, unknown>)};
    if (Array.isArray(cs.components)) {
      cs.components = cs.components.map(c =>
        normalizeComponentForProto(c as Record<string, unknown>),
      );
    }
    if (cs.dataModel && typeof cs.dataModel === 'object') {
      const structFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cs.dataModel as Record<string, unknown>)) {
        structFields[k] = jsValueToProtoValue(v);
      }
      cs.dataModel = {fields: structFields};
    }
    norm.createSurface = cs;
  }

  if (norm.updateComponents && typeof norm.updateComponents === 'object') {
    const uc = {...(norm.updateComponents as Record<string, unknown>)};
    if (Array.isArray(uc.components)) {
      uc.components = uc.components.map(c =>
        normalizeComponentForProto(c as Record<string, unknown>),
      );
    }
    norm.updateComponents = uc;
  }

  if (norm.updateDataModel && typeof norm.updateDataModel === 'object') {
    const ud = {...(norm.updateDataModel as Record<string, unknown>)};
    if ('value' in ud) {
      ud.value = jsValueToProtoValue(ud.value);
    }
    norm.updateDataModel = ud;
  }

  return norm;
}

/**
 * Denormalizes an AgentToRenderer Protobuf object into an A2UI JSON payload.
 */
export function denormalizeAgentPayloadFromProto(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const denorm = {...payload};

  if (denorm.createSurface && typeof denorm.createSurface === 'object') {
    const cs = {...(denorm.createSurface as Record<string, unknown>)};
    if (Array.isArray(cs.components)) {
      cs.components = cs.components.map(c =>
        denormalizeComponentFromProto(c as Record<string, unknown>),
      );
    }
    if (cs.dataModel && typeof cs.dataModel === 'object') {
      cs.dataModel = protoValueToJsValue(cs.dataModel);
    }
    denorm.createSurface = cs;
  }

  if (denorm.updateComponents && typeof denorm.updateComponents === 'object') {
    const uc = {...(denorm.updateComponents as Record<string, unknown>)};
    if (Array.isArray(uc.components)) {
      uc.components = uc.components.map(c =>
        denormalizeComponentFromProto(c as Record<string, unknown>),
      );
    }
    denorm.updateComponents = uc;
  }

  if (denorm.updateDataModel && typeof denorm.updateDataModel === 'object') {
    const ud = {...(denorm.updateDataModel as Record<string, unknown>)};
    if ('value' in ud) {
      ud.value = protoValueToJsValue(ud.value);
    }
    denorm.updateDataModel = ud;
  }

  return denorm;
}

/**
 * Encodes an A2UI Agent-to-Renderer message dictionary into binary Protobuf bytes.
 */
export function encodeAgentToRendererMessage(msg: Record<string, unknown>): Uint8Array {
  const normalized = normalizeAgentPayloadForProto(msg);
  const errMsg = AgentToRendererMessageType.verify(normalized);
  if (errMsg) {
    throw new Error(`Protobuf verification failed for AgentToRendererMessage: ${errMsg}`);
  }
  const message = AgentToRendererMessageType.create(normalized);
  return AgentToRendererMessageType.encode(message).finish();
}

/**
 * Decodes binary Protobuf bytes or Protobuf object instances into A2UI message dictionaries.
 */
export function decodeAgentToRendererMessages(
  input: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
): Record<string, unknown>[] {
  if (!input) return [];

  // If already a plain JS dictionary (from JSON or pre-parsed)
  if (
    typeof input === 'object' &&
    !(input instanceof Uint8Array) &&
    !(input instanceof ArrayBuffer)
  ) {
    // Check if it is a Protobuf Message instance with $type
    if ('$type' in input || AgentToRendererMessageType.verify(input) === null) {
      const obj = AgentToRendererMessageType.toObject(AgentToRendererMessageType.create(input), {
        defaults: false,
      });
      return [denormalizeAgentPayloadFromProto(obj)];
    }
    return [input as Record<string, unknown>];
  }

  // Convert ArrayBuffer or base64 string to Uint8Array
  let bytes: Uint8Array;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (typeof input === 'string') {
    // Assume base64
    bytes = Uint8Array.from(atob(input), c => c.charCodeAt(0));
  } else {
    return [];
  }

  // 1. Try decoding as AgentToRendererMessage
  try {
    const decoded = AgentToRendererMessageType.decode(bytes);
    const obj = AgentToRendererMessageType.toObject(decoded, {defaults: false});
    // Check if any message field (createSurface, updateComponents, updateDataModel, deleteSurface, etc.) is set
    const hasMessageField =
      obj.createSurface ||
      obj.updateComponents ||
      obj.updateDataModel ||
      obj.deleteSurface ||
      obj.callRendererFunction ||
      obj.agentFunctionResponse;
    if (hasMessageField) {
      return [denormalizeAgentPayloadFromProto(obj)];
    }
  } catch {
    // Fall through to list types
  }

  // 2. Try decoding as AgentToRendererListWrapper
  try {
    const decoded = AgentToRendererListWrapperType.decode(bytes);
    const obj = AgentToRendererListWrapperType.toObject(decoded, {defaults: false});
    const messages = obj.messages?.messages || [];
    if (messages.length > 0) {
      return messages.map((m: Record<string, unknown>) => denormalizeAgentPayloadFromProto(m));
    }
  } catch {
    // Fall through
  }

  // 3. Try decoding as AgentToRendererMessageList
  try {
    const decoded = AgentToRendererMessageListType.decode(bytes);
    const obj = AgentToRendererMessageListType.toObject(decoded, {defaults: false});
    const messages = obj.messages || [];
    if (messages.length > 0) {
      return messages.map((m: Record<string, unknown>) => denormalizeAgentPayloadFromProto(m));
    }
  } catch {
    // Fall through
  }

  return [];
}

/**
 * Encodes a Renderer-to-Agent message dictionary into binary Protobuf bytes.
 */
export function encodeRendererToAgentMessage(msg: Record<string, unknown>): Uint8Array {
  const errMsg = RendererToAgentMessageType.verify(msg);
  if (errMsg) {
    throw new Error(`Protobuf verification failed for RendererToAgentMessage: ${errMsg}`);
  }
  const message = RendererToAgentMessageType.create(msg);
  return RendererToAgentMessageType.encode(message).finish();
}

/**
 * Decodes binary Protobuf bytes into a Renderer-to-Agent message dictionary.
 */
export function decodeRendererToAgentMessage(
  input: Uint8Array | ArrayBuffer | string | Record<string, unknown>,
): Record<string, unknown> {
  if (
    typeof input === 'object' &&
    !(input instanceof Uint8Array) &&
    !(input instanceof ArrayBuffer)
  ) {
    return input as Record<string, unknown>;
  }
  let bytes: Uint8Array;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (typeof input === 'string') {
    bytes = Uint8Array.from(atob(input), c => c.charCodeAt(0));
  } else {
    throw new Error('Unsupported input format for RendererToAgentMessage');
  }

  const decoded = RendererToAgentMessageType.decode(bytes);
  return RendererToAgentMessageType.toObject(decoded, {defaults: false});
}
