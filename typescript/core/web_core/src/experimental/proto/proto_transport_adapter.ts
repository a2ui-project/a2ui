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

import {A2uiValidationError} from '../../errors.js';
import type {ProtocolVersion} from '../../processing/adapters/base.js';
import {
  INTERNAL_RAW_PAYLOAD,
  type InternalComponentPayload,
  type InternalOperation,
} from '../../processing/operations.js';
import {
  decodeAgentToRendererMessage,
  decodeLengthDelimitedFrames,
  encodeRendererToAgentMessage,
  type ProtoAny,
  type WireComponentEnvelope,
  type WireRendererToAgentMessage,
} from './proto_wire_codec.js';

/** Context handed to a {@link ComponentProtoDecoder} when unpacking `Component.typed_payload`. */
export interface ComponentProtoDecodeContext {
  readonly id: string;
  readonly component: string;
  readonly catalogId?: string;
  readonly typeUrl: string;
}

/** Normalized properties and optional static `rawPayload` returned by a component proto decoder. */
export interface ComponentProtoDecodeResult {
  /** Component property map validated against `CatalogModel` by `MessageProcessor`. */
  readonly properties: Record<string, unknown>;
  /** Optional static raw wire payload escape hatch forwarded to `ComponentModel.rawPayload`. */
  readonly rawPayload?: unknown;
}

/**
 * Tree-shakeable decoder for a strongly typed `Component.typed_payload` (`google.protobuf.Any`).
 */
export type ComponentProtoDecoder = (
  bytes: Uint8Array,
  context: ComponentProtoDecodeContext,
) => ComponentProtoDecodeResult;

/**
 * Tree-shakeable decoder for `UpdateDataModel.typed_value` (`google.protobuf.Any`),
 * e.g. unpacking `webutil.html.types.TrustedResourceUrlProto` via `TrustedResourceUrl.fromProto(bytes)`.
 */
export type OpaqueValueProtoDecoder<T = unknown> = (bytes: Uint8Array, typeUrl: string) => T;

/** Options configuring a {@link ProtoTransportAdapter}. */
export interface ProtoTransportAdapterOptions {
  /**
   * Closure-tree-shakeable map of component decoders keyed by
   * `'${catalogId}#${componentName}'`, `'${componentName}'`, or `Any.type_url`.
   */
  readonly componentDecoders?: ReadonlyMap<string, ComponentProtoDecoder>;
  /**
   * Closure-tree-shakeable map of opaque value decoders for `UpdateDataModel.typed_value`,
   * keyed by `Any.type_url` or bare proto type name (without `'type.googleapis.com/'`).
   */
  readonly opaqueValueDecoders?: ReadonlyMap<string, OpaqueValueProtoDecoder>;
  /** Default protocol version when an envelope omits `version`. Defaults to `'1.0'`. */
  readonly defaultVersion?: ProtocolVersion;
}

const RESERVED_STRUCT_ENVELOPE_KEYS = new Set([
  'id',
  'component',
  '@catalogId',
  '@accessibility',
  '@metadata',
  '@checks',
]);

function bareTypeName(typeUrl: string): string {
  const slash = typeUrl.lastIndexOf('/');
  return slash >= 0 ? typeUrl.slice(slash + 1) : typeUrl;
}

/**
 * Transport adapter decoding binary A2UI v1.0 Protobuf `AgentToRendererMessage`
 * frames into canonical {@link InternalOperation} instances for
 * `MessageProcessor.processOperations(...)`.
 *
 * Uses explicit `Map` lookup tables rather than a global `Any` reflection registry
 * so Closure Compiler dead-code elimination only bundles the component and opaque
 * value decoders actually registered by the host application.
 */
export class ProtoTransportAdapter {
  private readonly componentDecoders: ReadonlyMap<string, ComponentProtoDecoder>;
  private readonly opaqueValueDecoders: ReadonlyMap<string, OpaqueValueProtoDecoder>;
  private readonly defaultVersion: ProtocolVersion;

  constructor(options: ProtoTransportAdapterOptions = {}) {
    this.componentDecoders = options.componentDecoders
      ? new Map(options.componentDecoders)
      : new Map();
    this.opaqueValueDecoders = options.opaqueValueDecoders
      ? new Map(options.opaqueValueDecoders)
      : new Map();
    this.defaultVersion = options.defaultVersion ?? '1.0';
  }

  /**
   * Decodes a single binary Protobuf `AgentToRendererMessage` frame into
   * canonical {@link InternalOperation}s ready for `MessageProcessor.processOperations`.
   */
  decode(frame: Uint8Array): InternalOperation[] {
    const wire = decodeAgentToRendererMessage(frame);
    const version = (wire.version ?? this.defaultVersion) as ProtocolVersion;

    switch (wire.kind) {
      case 'createSurface': {
        const cs = wire.createSurface;
        return [
          {
            type: 'createSurface',
            surfaceId: cs.surfaceId,
            ...(cs.catalogId !== undefined ? {catalogId: cs.catalogId} : {}),
            ...(cs.sendDataModel !== undefined ? {sendDataModel: cs.sendDataModel} : {}),
            ...(cs.components !== undefined
              ? {components: cs.components.map(c => this.decodeComponent(c))}
              : {}),
            ...(cs.dataModel !== undefined ? {dataModel: cs.dataModel} : {}),
            ...(cs.metadata !== undefined ? {metadata: cs.metadata} : {}),
            ...(cs.rootId !== undefined ? {rootId: cs.rootId} : {}),
            ...(cs.theme !== undefined ? {theme: cs.theme} : {}),
            version,
            envelopeContext: {version, surfaceId: cs.surfaceId, actionType: 'createSurface'},
          },
        ];
      }
      case 'updateComponents': {
        const uc = wire.updateComponents;
        return [
          {
            type: 'updateComponents',
            surfaceId: uc.surfaceId,
            components: uc.components.map(c => this.decodeComponent(c)),
            version,
            envelopeContext: {version, surfaceId: uc.surfaceId, actionType: 'updateComponents'},
          },
        ];
      }
      case 'updateDataModel': {
        const ud = wire.updateDataModel;
        let value: unknown = undefined;
        if (ud.typedValue !== undefined) {
          value = this.decodeOpaqueAny(ud.typedValue);
        } else if (ud.hasValue) {
          value = ud.value;
        }
        return [
          {
            type: 'updateDataModel',
            surfaceId: ud.surfaceId,
            ...(ud.path !== undefined ? {path: ud.path} : {}),
            value,
            version,
            envelopeContext: {version, surfaceId: ud.surfaceId, actionType: 'updateDataModel'},
          },
        ];
      }
      case 'deleteSurface': {
        return [
          {
            type: 'deleteSurface',
            surfaceId: wire.deleteSurface.surfaceId,
            version,
            envelopeContext: {
              version,
              surfaceId: wire.deleteSurface.surfaceId,
              actionType: 'deleteSurface',
            },
          },
        ];
      }
      case 'callRendererFunction': {
        const crf = wire.callRendererFunction;
        return [
          {
            type: 'callRendererFunction',
            ...(crf.surfaceId !== undefined ? {surfaceId: crf.surfaceId} : {}),
            functionCallId: crf.functionCallId,
            call: crf.callFunction['@call'],
            version,
            ...(crf.callFunction.catalogId !== undefined
              ? {catalogId: crf.callFunction.catalogId}
              : {}),
            args: crf.callFunction.args ?? {},
            envelopeContext: {
              version,
              ...(crf.surfaceId !== undefined ? {surfaceId: crf.surfaceId} : {}),
              functionCallId: crf.functionCallId,
              actionType: 'callRendererFunction',
            },
          },
        ];
      }
      case 'agentFunctionResponse': {
        const afr = wire.agentFunctionResponse;
        return [
          {
            type: 'agentFunctionResponse',
            functionCallId: afr.functionCallId,
            version,
            ...(afr.hasValue ? {value: afr.value} : {}),
            ...(afr.error !== undefined
              ? {error: {code: afr.error.code, message: afr.error.message}}
              : {}),
            envelopeContext: {
              version,
              functionCallId: afr.functionCallId,
              actionType: 'agentFunctionResponse',
            },
          },
        ];
      }
    }
  }

  /** Decodes a sequence of binary `AgentToRendererMessage` frames into flat operations. */
  decodeFrames(frames: Iterable<Uint8Array>): InternalOperation[] {
    const ops: InternalOperation[] = [];
    for (const frame of frames) {
      ops.push(...this.decode(frame));
    }
    return ops;
  }

  /** Decodes a varint-length-delimited binary protobuf stream chunk into operations. */
  decodeLengthDelimitedStream(chunk: Uint8Array): InternalOperation[] {
    return this.decodeFrames(decodeLengthDelimitedFrames(chunk));
  }

  /** Encodes an outbound `RendererToAgentMessage` into binary protobuf wire bytes. */
  encodeRendererMessage(message: WireRendererToAgentMessage): Uint8Array {
    return encodeRendererToAgentMessage({
      version: message.version ?? this.defaultVersion,
      ...message,
    });
  }

  private lookupComponentDecoder(
    component: string,
    catalogId: string | undefined,
    typeUrl: string,
  ): ComponentProtoDecoder | undefined {
    if (catalogId !== undefined) {
      const scoped = this.componentDecoders.get(`${catalogId}#${component}`);
      if (scoped) return scoped;
    }
    return (
      this.componentDecoders.get(component) ??
      this.componentDecoders.get(typeUrl) ??
      this.componentDecoders.get(bareTypeName(typeUrl))
    );
  }

  private decodeOpaqueAny(anyMsg: ProtoAny): unknown {
    const decoder =
      this.opaqueValueDecoders.get(anyMsg.typeUrl) ??
      this.opaqueValueDecoders.get(bareTypeName(anyMsg.typeUrl));
    if (!decoder) {
      throw new A2uiValidationError(
        `No OpaqueValueProtoDecoder registered for protobuf Any type '${anyMsg.typeUrl}'.`,
      );
    }
    return decoder(anyMsg.value, anyMsg.typeUrl);
  }

  private decodeComponent(wire: WireComponentEnvelope): InternalComponentPayload {
    let properties: Record<string, unknown> = {};
    let rawPayload: unknown = undefined;

    if (wire.typedPayload !== undefined) {
      const compName = wire.component ?? '';
      const decoder = this.lookupComponentDecoder(
        compName,
        wire.catalogId,
        wire.typedPayload.typeUrl,
      );
      if (!decoder) {
        throw new A2uiValidationError(
          `No ComponentProtoDecoder registered for component '${compName}' ` +
            `(catalog '${wire.catalogId ?? 'default'}', typeUrl '${wire.typedPayload.typeUrl}').`,
        );
      }
      const decoded = decoder(wire.typedPayload.value, {
        id: wire.id,
        component: compName,
        catalogId: wire.catalogId,
        typeUrl: wire.typedPayload.typeUrl,
      });
      properties = decoded.properties;
      rawPayload = decoded.rawPayload;
    } else if (wire.properties !== undefined) {
      for (const key of Object.keys(wire.properties)) {
        if (RESERVED_STRUCT_ENVELOPE_KEYS.has(key)) {
          throw new A2uiValidationError(
            `Component.properties Struct for '${wire.id}' must not contain envelope field '${key}'; set it on the Component protobuf envelope instead.`,
          );
        }
      }
      properties = wire.properties;
    }

    const payload: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(properties)) {
      Object.defineProperty(payload, key, {
        value: val,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    payload['id'] = wire.id;
    if (wire.component !== undefined) payload['component'] = wire.component;
    if (wire.catalogId !== undefined) payload['@catalogId'] = wire.catalogId;
    if (wire.accessibility !== undefined) payload['@accessibility'] = wire.accessibility;
    if (wire.metadata !== undefined) payload['@metadata'] = wire.metadata;
    if (wire.checks !== undefined && wire.checks.length > 0) payload['@checks'] = wire.checks;
    if (rawPayload !== undefined) {
      Object.defineProperty(payload, INTERNAL_RAW_PAYLOAD, {
        value: rawPayload,
        enumerable: false,
        writable: false,
        configurable: true,
      });
    }
    return payload as InternalComponentPayload;
  }
}
