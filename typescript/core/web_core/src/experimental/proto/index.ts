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

/**
 * Experimental Protobuf transport adapter, canonical Edition 2023 v1.0 wire envelope,
 * zero-dependency binary wire codec, and bidirectional `CatalogModel` <-> `.proto` codegen.
 */

export {A2UI_V1_ENVELOPE_PROTO, ENVELOPE_TAGS} from './envelope_proto.js';
export {
  A2uiProtoCodegenError,
  generateProtoFromCatalogModel,
  type OpaqueFormatProtoMapping,
  type ProtoCodegenOptions,
  type ProtoCodegenResult,
  type ProtoTagLockfile,
} from './catalog_to_proto.js';
export {
  DEFAULT_SECURITY_PROTO_FORMATS,
  protoDescriptorToCatalogModel,
  type ProtoEnumDescriptor,
  type ProtoEnumValueDescriptor,
  type ProtoFieldDescriptor,
  type ProtoFieldKind,
  type ProtoFileDescriptor,
  type ProtoMessageDescriptor,
  type ReverseCodegenOptions,
} from './proto_to_catalog.js';
export {
  MAX_PROTO_DEPTH,
  ProtoWireReader,
  ProtoWireWriter,
  WireType,
  decodeAccessibilityAttributes,
  decodeAction,
  decodeAgentToRendererMessage,
  decodeAny,
  decodeCheckRule,
  decodeChildList,
  decodeComponentEnvelope,
  decodeDataBinding,
  decodeDynamicBoolean,
  decodeDynamicNumber,
  decodeDynamicString,
  decodeDynamicValue,
  decodeFunctionCall,
  decodeLengthDelimitedFrames,
  decodeProtoListValue,
  decodeProtoStruct,
  decodeProtoValue,
  decodeRendererToAgentMessage,
  encodeAccessibilityAttributes,
  encodeAction,
  encodeAgentToRendererMessage,
  encodeAny,
  encodeCheckRule,
  encodeChildList,
  encodeComponentEnvelope,
  encodeDataBinding,
  encodeDynamicBoolean,
  encodeDynamicNumber,
  encodeDynamicString,
  encodeDynamicValue,
  encodeFunctionCall,
  encodeLengthDelimitedFrame,
  encodeProtoListValue,
  encodeProtoStruct,
  encodeProtoValue,
  encodeRendererToAgentMessage,
  type ProtoAny,
  type WireAccessibilityAttributes,
  type WireAction,
  type WireAgentToRendererMessage,
  type WireCheckRule,
  type WireChildList,
  type WireComponentEnvelope,
  type WireFunctionCall,
  type WireRendererToAgentMessage,
} from './proto_wire_codec.js';
export {
  ProtoTransportAdapter,
  type ComponentProtoDecodeContext,
  type ComponentProtoDecodeResult,
  type ComponentProtoDecoder,
  type OpaqueValueProtoDecoder,
  type ProtoTransportAdapterOptions,
} from './proto_transport_adapter.js';
