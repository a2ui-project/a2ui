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
import {ENVELOPE_TAGS} from './envelope_proto.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', {fatal: true});

/** Standard Protobuf binary wire types. */
export const WireType = {
  VARINT: 0,
  FIXED64: 1,
  LEN: 2,
  FIXED32: 5,
} as const;

export type WireType = (typeof WireType)[keyof typeof WireType];

/** Decoded `google.protobuf.Any` message (`string type_url = 1; bytes value = 2;`). */
export interface ProtoAny {
  readonly typeUrl: string;
  readonly value: Uint8Array;
}

/** Minimal zero-dependency Protobuf binary wire writer. */
export class ProtoWireWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(initialCapacity = 64) {
    this.buf = new Uint8Array(initialCapacity);
  }

  private ensure(extra: number): void {
    const needed = this.len + extra;
    if (needed <= this.buf.length) return;
    let nextCap = this.buf.length * 2;
    while (nextCap < needed) {
      nextCap *= 2;
    }
    const next = new Uint8Array(nextCap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  writeRawVarint(value: number | bigint): this {
    let v = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
    if (v < 0n) {
      // Standard Protobuf 64-bit two's complement representation for negative varints.
      v = BigInt.asUintN(64, v);
    }
    this.ensure(10);
    while (v >= 0x80n) {
      this.buf[this.len++] = Number((v & 0x7fn) | 0x80n);
      v >>= 7n;
    }
    this.buf[this.len++] = Number(v);
    return this;
  }

  writeTag(fieldNumber: number, wireType: WireType): this {
    return this.writeRawVarint((BigInt(fieldNumber) << 3n) | BigInt(wireType));
  }

  writeBool(fieldNumber: number, value: boolean): this {
    this.writeTag(fieldNumber, WireType.VARINT);
    return this.writeRawVarint(value ? 1 : 0);
  }

  writeUint32(fieldNumber: number, value: number): this {
    this.writeTag(fieldNumber, WireType.VARINT);
    return this.writeRawVarint(value >>> 0);
  }

  writeInt64(fieldNumber: number, value: number | bigint): this {
    this.writeTag(fieldNumber, WireType.VARINT);
    return this.writeRawVarint(value);
  }

  writeEnum(fieldNumber: number, value: number): this {
    this.writeTag(fieldNumber, WireType.VARINT);
    return this.writeRawVarint(value);
  }

  writeDouble(fieldNumber: number, value: number): this {
    this.writeTag(fieldNumber, WireType.FIXED64);
    this.ensure(8);
    new DataView(this.buf.buffer, this.buf.byteOffset + this.len, 8).setFloat64(0, value, true);
    this.len += 8;
    return this;
  }

  writeFloat(fieldNumber: number, value: number): this {
    this.writeTag(fieldNumber, WireType.FIXED32);
    this.ensure(4);
    new DataView(this.buf.buffer, this.buf.byteOffset + this.len, 4).setFloat32(0, value, true);
    this.len += 4;
    return this;
  }

  writeBytes(fieldNumber: number, bytes: Uint8Array): this {
    this.writeTag(fieldNumber, WireType.LEN);
    this.writeRawVarint(bytes.byteLength);
    this.ensure(bytes.byteLength);
    this.buf.set(bytes, this.len);
    this.len += bytes.byteLength;
    return this;
  }

  writeString(fieldNumber: number, value: string): this {
    return this.writeBytes(fieldNumber, textEncoder.encode(value));
  }

  writeMessage(fieldNumber: number, encodeFn: (writer: ProtoWireWriter) => void): this {
    const nested = new ProtoWireWriter();
    encodeFn(nested);
    return this.writeBytes(fieldNumber, nested.finish());
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/** Minimal zero-dependency Protobuf binary wire reader. */
export class ProtoWireReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  hasMore(): boolean {
    return this.pos < this.bytes.byteLength;
  }

  readRawVarint(): bigint {
    let result = 0n;
    let shift = 0n;
    while (this.pos < this.bytes.byteLength) {
      const byte = this.bytes[this.pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result;
      }
      shift += 7n;
      if (shift > 63n) {
        throw new A2uiValidationError('Malformed protobuf varint: exceeded 64 bits.');
      }
    }
    throw new A2uiValidationError('Truncated protobuf varint.');
  }

  readTag(): {readonly fieldNumber: number; readonly wireType: WireType} {
    const raw = this.readRawVarint();
    const fieldNumber = Number(raw >> 3n);
    const wireType = Number(raw & 0x7n) as WireType;
    if (fieldNumber <= 0) {
      throw new A2uiValidationError(`Invalid protobuf field number: ${fieldNumber}.`);
    }
    return {fieldNumber, wireType};
  }

  readBool(): boolean {
    return this.readRawVarint() !== 0n;
  }

  readUint32(): number {
    return Number(BigInt.asUintN(32, this.readRawVarint()));
  }

  readInt64(): number {
    return Number(BigInt.asIntN(64, this.readRawVarint()));
  }

  readEnum(): number {
    return Number(BigInt.asIntN(32, this.readRawVarint()));
  }

  readDouble(): number {
    if (this.pos + 8 > this.bytes.byteLength) {
      throw new A2uiValidationError('Truncated protobuf fixed64/double value.');
    }
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getFloat64(0, true);
  }

  readFloat(): number {
    if (this.pos + 4 > this.bytes.byteLength) {
      throw new A2uiValidationError('Truncated protobuf fixed32/float value.');
    }
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4);
    this.pos += 4;
    return view.getFloat32(0, true);
  }

  readBytes(): Uint8Array {
    const len = Number(this.readRawVarint());
    if (len < 0 || this.pos + len > this.bytes.byteLength) {
      throw new A2uiValidationError(
        `Truncated protobuf length-delimited field: expected ${len} byte(s).`,
      );
    }
    const slice = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }

  readString(): string {
    return textDecoder.decode(this.readBytes());
  }

  skipField(wireType: WireType): void {
    switch (wireType) {
      case WireType.VARINT:
        this.readRawVarint();
        break;
      case WireType.FIXED64:
        this.readDouble();
        break;
      case WireType.LEN:
        this.readBytes();
        break;
      case WireType.FIXED32:
        this.readFloat();
        break;
      default:
        throw new A2uiValidationError(`Unsupported protobuf wire type: ${String(wireType)}.`);
    }
  }
}

// ============================================================================
// Length-Delimited Streaming Framing Helpers
// ============================================================================

/** Prefixes a binary protobuf message frame with its varint byte length. */
export function encodeLengthDelimitedFrame(frame: Uint8Array): Uint8Array {
  const writer = new ProtoWireWriter(frame.byteLength + 10);
  writer.writeRawVarint(frame.byteLength);
  const prefix = writer.finish();
  const out = new Uint8Array(prefix.byteLength + frame.byteLength);
  out.set(prefix, 0);
  out.set(frame, prefix.byteLength);
  return out;
}

/** Decodes a concatenated stream of varint-length-delimited binary protobuf frames. */
export function decodeLengthDelimitedFrames(chunk: Uint8Array): Uint8Array[] {
  const reader = new ProtoWireReader(chunk);
  const frames: Uint8Array[] = [];
  while (reader.hasMore()) {
    frames.push(reader.readBytes());
  }
  return frames;
}

// ============================================================================
// google.protobuf.Any
// ============================================================================

export function encodeAny(anyMsg: ProtoAny): Uint8Array {
  const w = new ProtoWireWriter();
  if (anyMsg.typeUrl) w.writeString(1, anyMsg.typeUrl);
  if (anyMsg.value.byteLength > 0) w.writeBytes(2, anyMsg.value);
  return w.finish();
}

export function decodeAny(bytes: Uint8Array): ProtoAny {
  const r = new ProtoWireReader(bytes);
  let typeUrl = '';
  let value: Uint8Array = new Uint8Array(0);
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === 1 && wireType === WireType.LEN) {
      typeUrl = r.readString();
    } else if (fieldNumber === 2 && wireType === WireType.LEN) {
      value = r.readBytes();
    } else {
      r.skipField(wireType);
    }
  }
  return {typeUrl, value};
}

// ============================================================================
// google.protobuf.Value / Struct / ListValue
// ============================================================================

export function encodeProtoValue(value: unknown): Uint8Array {
  const w = new ProtoWireWriter();
  if (value === null || value === undefined) {
    w.writeEnum(1, 0); // NullValue.NULL_VALUE = 0
  } else if (typeof value === 'number') {
    w.writeDouble(2, value);
  } else if (typeof value === 'string') {
    w.writeString(3, value);
  } else if (typeof value === 'boolean') {
    w.writeBool(4, value);
  } else if (Array.isArray(value)) {
    w.writeBytes(6, encodeProtoListValue(value));
  } else if (typeof value === 'object') {
    w.writeBytes(5, encodeProtoStruct(value as Record<string, unknown>));
  } else {
    throw new A2uiValidationError(
      `Unsupported value type for google.protobuf.Value: ${typeof value}.`,
    );
  }
  return w.finish();
}

export function decodeProtoValue(bytes: Uint8Array): unknown {
  const r = new ProtoWireReader(bytes);
  let result: unknown = null;
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    switch (fieldNumber) {
      case 1:
        r.readEnum();
        result = null;
        break;
      case 2:
        result = r.readDouble();
        break;
      case 3:
        result = r.readString();
        break;
      case 4:
        result = r.readBool();
        break;
      case 5:
        result = decodeProtoStruct(r.readBytes());
        break;
      case 6:
        result = decodeProtoListValue(r.readBytes());
        break;
      default:
        r.skipField(wireType);
    }
  }
  return result;
}

export function encodeProtoListValue(values: readonly unknown[]): Uint8Array {
  const w = new ProtoWireWriter();
  for (const item of values) {
    w.writeBytes(1, encodeProtoValue(item));
  }
  return w.finish();
}

export function decodeProtoListValue(bytes: Uint8Array): unknown[] {
  const r = new ProtoWireReader(bytes);
  const out: unknown[] = [];
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === 1 && wireType === WireType.LEN) {
      out.push(decodeProtoValue(r.readBytes()));
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

export function encodeProtoStruct(obj: Readonly<Record<string, unknown>>): Uint8Array {
  const w = new ProtoWireWriter();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    w.writeMessage(1, entry => {
      entry.writeString(1, k);
      entry.writeBytes(2, encodeProtoValue(v));
    });
  }
  return w.finish();
}

export function decodeProtoStruct(bytes: Uint8Array): Record<string, unknown> {
  const r = new ProtoWireReader(bytes);
  const out: Record<string, unknown> = {};
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === 1 && wireType === WireType.LEN) {
      const entryReader = new ProtoWireReader(r.readBytes());
      let key = '';
      let val: unknown = null;
      while (entryReader.hasMore()) {
        const entryTag = entryReader.readTag();
        if (entryTag.fieldNumber === 1 && entryTag.wireType === WireType.LEN) {
          key = entryReader.readString();
        } else if (entryTag.fieldNumber === 2 && entryTag.wireType === WireType.LEN) {
          val = decodeProtoValue(entryReader.readBytes());
        } else {
          entryReader.skipField(entryTag.wireType);
        }
      }
      Object.defineProperty(out, key, {
        value: val,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

// ============================================================================
// A2UI v1.0 Common Wire Primitives Codecs
// ============================================================================

export function encodeDataBinding(path: string): Uint8Array {
  return new ProtoWireWriter().writeString(ENVELOPE_TAGS.DataBinding.path, path).finish();
}

export function decodeDataBinding(bytes: Uint8Array): {'@path': string} {
  const r = new ProtoWireReader(bytes);
  let path = '';
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.DataBinding.path && wireType === WireType.LEN) {
      path = r.readString();
    } else {
      r.skipField(wireType);
    }
  }
  return {'@path': path};
}

export interface WireFunctionCall {
  readonly '@call': string;
  readonly catalogId?: string;
  readonly args?: Record<string, unknown>;
}

export function encodeFunctionCall(fc: WireFunctionCall): Uint8Array {
  const w = new ProtoWireWriter();
  w.writeString(ENVELOPE_TAGS.FunctionCall.call, fc['@call']);
  if (fc.catalogId !== undefined) {
    w.writeString(ENVELOPE_TAGS.FunctionCall.catalogId, fc.catalogId);
  }
  if (fc.args !== undefined) {
    w.writeBytes(ENVELOPE_TAGS.FunctionCall.args, encodeProtoStruct(fc.args));
  }
  return w.finish();
}

export function decodeFunctionCall(bytes: Uint8Array): WireFunctionCall {
  const r = new ProtoWireReader(bytes);
  let call = '';
  let catalogId: string | undefined;
  let args: Record<string, unknown> | undefined;
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.FunctionCall.call && wireType === WireType.LEN) {
      call = r.readString();
    } else if (fieldNumber === ENVELOPE_TAGS.FunctionCall.catalogId && wireType === WireType.LEN) {
      catalogId = r.readString();
    } else if (fieldNumber === ENVELOPE_TAGS.FunctionCall.args && wireType === WireType.LEN) {
      args = decodeProtoStruct(r.readBytes());
    } else {
      r.skipField(wireType);
    }
  }
  return {
    '@call': call,
    ...(catalogId !== undefined ? {catalogId} : {}),
    ...(args !== undefined ? {args} : {}),
  };
}

function isBindingRecord(val: unknown): val is {'@path': string} {
  return (
    typeof val === 'object' &&
    val !== null &&
    !Array.isArray(val) &&
    typeof (val as Record<string, unknown>)['@path'] === 'string'
  );
}

function isCallRecord(val: unknown): val is WireFunctionCall {
  return (
    typeof val === 'object' &&
    val !== null &&
    !Array.isArray(val) &&
    typeof (val as Record<string, unknown>)['@call'] === 'string'
  );
}

export function encodeDynamicString(
  val: string | {'@path': string} | WireFunctionCall,
): Uint8Array {
  const w = new ProtoWireWriter();
  if (typeof val === 'string') {
    w.writeString(ENVELOPE_TAGS.Dynamic.literal, val);
  } else if (isBindingRecord(val)) {
    w.writeBytes(ENVELOPE_TAGS.Dynamic.dataBinding, encodeDataBinding(val['@path']));
  } else if (isCallRecord(val)) {
    w.writeBytes(ENVELOPE_TAGS.Dynamic.functionCall, encodeFunctionCall(val));
  }
  return w.finish();
}

export function decodeDynamicString(
  bytes: Uint8Array,
): string | {'@path': string} | WireFunctionCall {
  const r = new ProtoWireReader(bytes);
  let out: string | {'@path': string} | WireFunctionCall = '';
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.Dynamic.literal && wireType === WireType.LEN) {
      out = r.readString();
    } else if (fieldNumber === ENVELOPE_TAGS.Dynamic.dataBinding && wireType === WireType.LEN) {
      out = decodeDataBinding(r.readBytes());
    } else if (fieldNumber === ENVELOPE_TAGS.Dynamic.functionCall && wireType === WireType.LEN) {
      out = decodeFunctionCall(r.readBytes());
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

export function encodeDynamicNumber(
  val: number | {'@path': string} | WireFunctionCall,
): Uint8Array {
  const w = new ProtoWireWriter();
  if (typeof val === 'number') {
    w.writeDouble(ENVELOPE_TAGS.Dynamic.literal, val);
  } else if (isBindingRecord(val)) {
    w.writeBytes(ENVELOPE_TAGS.Dynamic.dataBinding, encodeDataBinding(val['@path']));
  } else if (isCallRecord(val)) {
    w.writeBytes(ENVELOPE_TAGS.Dynamic.functionCall, encodeFunctionCall(val));
  }
  return w.finish();
}

export function decodeDynamicNumber(
  bytes: Uint8Array,
): number | {'@path': string} | WireFunctionCall {
  const r = new ProtoWireReader(bytes);
  let out: number | {'@path': string} | WireFunctionCall = 0;
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.Dynamic.literal && wireType === WireType.FIXED64) {
      out = r.readDouble();
    } else if (fieldNumber === ENVELOPE_TAGS.Dynamic.dataBinding && wireType === WireType.LEN) {
      out = decodeDataBinding(r.readBytes());
    } else if (fieldNumber === ENVELOPE_TAGS.Dynamic.functionCall && wireType === WireType.LEN) {
      out = decodeFunctionCall(r.readBytes());
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

export function encodeDynamicBoolean(
  val: boolean | {'@path': string} | WireFunctionCall,
): Uint8Array {
  const w = new ProtoWireWriter();
  if (typeof val === 'boolean') {
    w.writeBool(ENVELOPE_TAGS.Dynamic.literal, val);
  } else if (isBindingRecord(val)) {
    w.writeBytes(ENVELOPE_TAGS.Dynamic.dataBinding, encodeDataBinding(val['@path']));
  } else if (isCallRecord(val)) {
    w.writeBytes(ENVELOPE_TAGS.Dynamic.functionCall, encodeFunctionCall(val));
  }
  return w.finish();
}

export function decodeDynamicBoolean(
  bytes: Uint8Array,
): boolean | {'@path': string} | WireFunctionCall {
  const r = new ProtoWireReader(bytes);
  let out: boolean | {'@path': string} | WireFunctionCall = false;
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.Dynamic.literal && wireType === WireType.VARINT) {
      out = r.readBool();
    } else if (fieldNumber === ENVELOPE_TAGS.Dynamic.dataBinding && wireType === WireType.LEN) {
      out = decodeDataBinding(r.readBytes());
    } else if (fieldNumber === ENVELOPE_TAGS.Dynamic.functionCall && wireType === WireType.LEN) {
      out = decodeFunctionCall(r.readBytes());
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

export function encodeDynamicValue(val: unknown): Uint8Array {
  const w = new ProtoWireWriter();
  if (isBindingRecord(val)) {
    w.writeBytes(ENVELOPE_TAGS.Dynamic.dataBinding, encodeDataBinding(val['@path']));
  } else if (isCallRecord(val)) {
    w.writeBytes(ENVELOPE_TAGS.Dynamic.functionCall, encodeFunctionCall(val));
  } else {
    w.writeBytes(ENVELOPE_TAGS.Dynamic.literal, encodeProtoValue(val));
  }
  return w.finish();
}

export function decodeDynamicValue(bytes: Uint8Array): unknown {
  const r = new ProtoWireReader(bytes);
  let out: unknown = null;
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.Dynamic.literal && wireType === WireType.LEN) {
      out = decodeProtoValue(r.readBytes());
    } else if (fieldNumber === ENVELOPE_TAGS.Dynamic.dataBinding && wireType === WireType.LEN) {
      out = decodeDataBinding(r.readBytes());
    } else if (fieldNumber === ENVELOPE_TAGS.Dynamic.functionCall && wireType === WireType.LEN) {
      out = decodeFunctionCall(r.readBytes());
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

export type WireChildList =
  | readonly string[]
  | {readonly componentId: string; readonly path: string};

export function encodeChildList(val: WireChildList): Uint8Array {
  const w = new ProtoWireWriter();
  if (Array.isArray(val)) {
    w.writeMessage(ENVELOPE_TAGS.ChildList.staticList, listW => {
      for (const id of val) {
        listW.writeString(ENVELOPE_TAGS.StringList.values, id);
      }
    });
  } else {
    const tpl = val as {readonly componentId: string; readonly path: string};
    w.writeMessage(ENVELOPE_TAGS.ChildList.template, tplW => {
      tplW.writeString(ENVELOPE_TAGS.ChildListTemplate.componentId, tpl.componentId);
      tplW.writeString(ENVELOPE_TAGS.ChildListTemplate.path, tpl.path);
    });
  }
  return w.finish();
}

export function decodeChildList(bytes: Uint8Array): WireChildList {
  const r = new ProtoWireReader(bytes);
  let out: WireChildList = [];
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.ChildList.staticList && wireType === WireType.LEN) {
      const lr = new ProtoWireReader(r.readBytes());
      const ids: string[] = [];
      while (lr.hasMore()) {
        const lt = lr.readTag();
        if (lt.fieldNumber === ENVELOPE_TAGS.StringList.values && lt.wireType === WireType.LEN) {
          ids.push(lr.readString());
        } else {
          lr.skipField(lt.wireType);
        }
      }
      out = ids;
    } else if (fieldNumber === ENVELOPE_TAGS.ChildList.template && wireType === WireType.LEN) {
      const tr = new ProtoWireReader(r.readBytes());
      let componentId = '';
      let path = '';
      while (tr.hasMore()) {
        const tt = tr.readTag();
        if (
          tt.fieldNumber === ENVELOPE_TAGS.ChildListTemplate.componentId &&
          tt.wireType === WireType.LEN
        ) {
          componentId = tr.readString();
        } else if (
          tt.fieldNumber === ENVELOPE_TAGS.ChildListTemplate.path &&
          tt.wireType === WireType.LEN
        ) {
          path = tr.readString();
        } else {
          tr.skipField(tt.wireType);
        }
      }
      out = {componentId, path};
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

export type WireAction =
  | {
      readonly event: {
        readonly name: string;
        readonly userMessage?: string | {'@path': string} | WireFunctionCall;
        readonly context?: Readonly<Record<string, unknown>>;
      };
    }
  | {readonly functionCall: WireFunctionCall};

export function encodeAction(action: WireAction): Uint8Array {
  const w = new ProtoWireWriter();
  if ('event' in action) {
    w.writeMessage(ENVELOPE_TAGS.Action.event, evW => {
      evW.writeString(ENVELOPE_TAGS.ActionEvent.name, action.event.name);
      if (action.event.userMessage !== undefined) {
        evW.writeBytes(
          ENVELOPE_TAGS.ActionEvent.userMessage,
          encodeDynamicString(action.event.userMessage),
        );
      }
      if (action.event.context !== undefined) {
        for (const [k, v] of Object.entries(action.event.context)) {
          evW.writeMessage(ENVELOPE_TAGS.ActionEvent.context, mapW => {
            mapW.writeString(1, k);
            mapW.writeBytes(2, encodeDynamicValue(v));
          });
        }
      }
    });
  } else {
    w.writeBytes(ENVELOPE_TAGS.Action.functionCall, encodeFunctionCall(action.functionCall));
  }
  return w.finish();
}

export function decodeAction(bytes: Uint8Array): WireAction {
  const r = new ProtoWireReader(bytes);
  let out: WireAction = {event: {name: ''}};
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.Action.event && wireType === WireType.LEN) {
      const er = new ProtoWireReader(r.readBytes());
      let name = '';
      let userMessage: string | {'@path': string} | WireFunctionCall | undefined;
      let context: Record<string, unknown> | undefined;
      while (er.hasMore()) {
        const et = er.readTag();
        if (et.fieldNumber === ENVELOPE_TAGS.ActionEvent.name && et.wireType === WireType.LEN) {
          name = er.readString();
        } else if (
          et.fieldNumber === ENVELOPE_TAGS.ActionEvent.userMessage &&
          et.wireType === WireType.LEN
        ) {
          userMessage = decodeDynamicString(er.readBytes());
        } else if (
          et.fieldNumber === ENVELOPE_TAGS.ActionEvent.context &&
          et.wireType === WireType.LEN
        ) {
          const mr = new ProtoWireReader(er.readBytes());
          let k = '';
          let v: unknown = null;
          while (mr.hasMore()) {
            const mt = mr.readTag();
            if (mt.fieldNumber === 1 && mt.wireType === WireType.LEN) {
              k = mr.readString();
            } else if (mt.fieldNumber === 2 && mt.wireType === WireType.LEN) {
              v = decodeDynamicValue(mr.readBytes());
            } else {
              mr.skipField(mt.wireType);
            }
          }
          context ??= {};
          context[k] = v;
        } else {
          er.skipField(et.wireType);
        }
      }
      out = {
        event: {
          name,
          ...(userMessage !== undefined ? {userMessage} : {}),
          ...(context !== undefined ? {context} : {}),
        },
      };
    } else if (fieldNumber === ENVELOPE_TAGS.Action.functionCall && wireType === WireType.LEN) {
      out = {functionCall: decodeFunctionCall(r.readBytes())};
    } else {
      r.skipField(wireType);
    }
  }
  return out;
}

export interface WireCheckRule {
  readonly condition: {'@path': string} | WireFunctionCall;
  readonly message?: string;
}

export function encodeCheckRule(rule: WireCheckRule): Uint8Array {
  const w = new ProtoWireWriter();
  if (isBindingRecord(rule.condition)) {
    w.writeBytes(ENVELOPE_TAGS.CheckRule.dataBinding, encodeDataBinding(rule.condition['@path']));
  } else {
    w.writeBytes(ENVELOPE_TAGS.CheckRule.functionCall, encodeFunctionCall(rule.condition));
  }
  if (rule.message !== undefined) {
    w.writeString(ENVELOPE_TAGS.CheckRule.message, rule.message);
  }
  return w.finish();
}

export function decodeCheckRule(bytes: Uint8Array): WireCheckRule {
  const r = new ProtoWireReader(bytes);
  let condition: {'@path': string} | WireFunctionCall = {'@path': ''};
  let message: string | undefined;
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.CheckRule.dataBinding && wireType === WireType.LEN) {
      condition = decodeDataBinding(r.readBytes());
    } else if (fieldNumber === ENVELOPE_TAGS.CheckRule.functionCall && wireType === WireType.LEN) {
      condition = decodeFunctionCall(r.readBytes());
    } else if (fieldNumber === ENVELOPE_TAGS.CheckRule.message && wireType === WireType.LEN) {
      message = r.readString();
    } else {
      r.skipField(wireType);
    }
  }
  return {condition, ...(message !== undefined ? {message} : {})};
}

export interface WireAccessibilityAttributes {
  readonly label?: string | {'@path': string} | WireFunctionCall;
  readonly description?: string | {'@path': string} | WireFunctionCall;
  readonly live?: 'off' | 'polite' | 'assertive';
  readonly hidden?: boolean | {'@path': string} | WireFunctionCall;
}

const LIVE_REGION_TO_ENUM: Readonly<Record<'off' | 'polite' | 'assertive', number>> = {
  off: 1,
  polite: 2,
  assertive: 3,
};

const ENUM_TO_LIVE_REGION: Readonly<Record<number, 'off' | 'polite' | 'assertive'>> = {
  1: 'off',
  2: 'polite',
  3: 'assertive',
};

export function encodeAccessibilityAttributes(acc: WireAccessibilityAttributes): Uint8Array {
  const w = new ProtoWireWriter();
  if (acc.label !== undefined) {
    w.writeBytes(ENVELOPE_TAGS.AccessibilityAttributes.label, encodeDynamicString(acc.label));
  }
  if (acc.description !== undefined) {
    w.writeBytes(
      ENVELOPE_TAGS.AccessibilityAttributes.description,
      encodeDynamicString(acc.description),
    );
  }
  if (acc.live !== undefined) {
    w.writeEnum(ENVELOPE_TAGS.AccessibilityAttributes.live, LIVE_REGION_TO_ENUM[acc.live]);
  }
  if (acc.hidden !== undefined) {
    w.writeBytes(ENVELOPE_TAGS.AccessibilityAttributes.hidden, encodeDynamicBoolean(acc.hidden));
  }
  return w.finish();
}

export function decodeAccessibilityAttributes(bytes: Uint8Array): WireAccessibilityAttributes {
  const r = new ProtoWireReader(bytes);
  let label: string | {'@path': string} | WireFunctionCall | undefined;
  let description: string | {'@path': string} | WireFunctionCall | undefined;
  let live: 'off' | 'polite' | 'assertive' | undefined;
  let hidden: boolean | {'@path': string} | WireFunctionCall | undefined;
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.AccessibilityAttributes.label && wireType === WireType.LEN) {
      label = decodeDynamicString(r.readBytes());
    } else if (
      fieldNumber === ENVELOPE_TAGS.AccessibilityAttributes.description &&
      wireType === WireType.LEN
    ) {
      description = decodeDynamicString(r.readBytes());
    } else if (
      fieldNumber === ENVELOPE_TAGS.AccessibilityAttributes.live &&
      wireType === WireType.VARINT
    ) {
      live = ENUM_TO_LIVE_REGION[r.readEnum()];
    } else if (
      fieldNumber === ENVELOPE_TAGS.AccessibilityAttributes.hidden &&
      wireType === WireType.LEN
    ) {
      hidden = decodeDynamicBoolean(r.readBytes());
    } else {
      r.skipField(wireType);
    }
  }
  return {
    ...(label !== undefined ? {label} : {}),
    ...(description !== undefined ? {description} : {}),
    ...(live !== undefined ? {live} : {}),
    ...(hidden !== undefined ? {hidden} : {}),
  };
}

function encodeMetadataProto(metadata: Readonly<Record<string, unknown>>): Uint8Array {
  const w = new ProtoWireWriter();
  const ext = metadata['extensions'];
  if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
    w.writeBytes(
      ENVELOPE_TAGS.Metadata.extensions,
      encodeProtoStruct(ext as Record<string, unknown>),
    );
  }
  return w.finish();
}

function decodeMetadataProto(bytes: Uint8Array): Record<string, unknown> {
  const r = new ProtoWireReader(bytes);
  let extensions: Record<string, unknown> | undefined;
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.Metadata.extensions && wireType === WireType.LEN) {
      extensions = decodeProtoStruct(r.readBytes());
    } else {
      r.skipField(wireType);
    }
  }
  return extensions !== undefined ? {extensions} : {};
}

// ============================================================================
// Component & AgentToRendererMessage / RendererToAgentMessage Codecs
// ============================================================================

export interface WireComponentEnvelope {
  readonly id: string;
  readonly component?: string;
  readonly catalogId?: string;
  readonly accessibility?: WireAccessibilityAttributes;
  readonly metadata?: Record<string, unknown>;
  readonly checks?: readonly WireCheckRule[];
  readonly typedPayload?: ProtoAny;
  readonly properties?: Record<string, unknown>;
}

export type WireAgentToRendererMessage = {readonly version?: string} & (
  | {
      readonly kind: 'createSurface';
      readonly createSurface: {
        readonly surfaceId: string;
        readonly catalogId?: string;
        readonly sendDataModel?: boolean;
        readonly components?: readonly WireComponentEnvelope[];
        readonly dataModel?: Record<string, unknown>;
        readonly metadata?: Record<string, unknown>;
        readonly rootId?: string;
        readonly theme?: Record<string, unknown>;
      };
    }
  | {
      readonly kind: 'updateComponents';
      readonly updateComponents: {
        readonly surfaceId: string;
        readonly components: readonly WireComponentEnvelope[];
      };
    }
  | {
      readonly kind: 'updateDataModel';
      readonly updateDataModel: {
        readonly surfaceId: string;
        readonly path?: string;
        /** Explicit presence: when `hasValue` is true, `value` (including `null`) was sent. */
        readonly hasValue?: boolean;
        readonly value?: unknown;
        readonly typedValue?: ProtoAny;
      };
    }
  | {
      readonly kind: 'deleteSurface';
      readonly deleteSurface: {readonly surfaceId: string};
    }
  | {
      readonly kind: 'callRendererFunction';
      readonly callRendererFunction: {
        readonly surfaceId?: string;
        readonly functionCallId: string;
        readonly callFunction: WireFunctionCall;
      };
    }
  | {
      readonly kind: 'agentFunctionResponse';
      readonly agentFunctionResponse: {
        readonly functionCallId: string;
        readonly hasValue?: boolean;
        readonly value?: unknown;
        readonly error?: {readonly code: string; readonly message: string};
      };
    }
);

export type WireRendererToAgentMessage = {readonly version?: string} & (
  | {
      readonly kind: 'action';
      readonly action: {
        readonly name: string;
        readonly surfaceId: string;
        readonly sourceComponentId: string;
        readonly timestamp: string;
        readonly context?: Record<string, unknown>;
        readonly catalogId?: string;
        readonly userMessage?: string;
        readonly metadata?: Record<string, unknown>;
      };
    }
  | {
      readonly kind: 'callAgentFunction';
      readonly callAgentFunction: {
        readonly surfaceId: string;
        readonly functionCallId: string;
        readonly callFunction: WireFunctionCall;
      };
    }
  | {
      readonly kind: 'rendererFunctionResponse';
      readonly rendererFunctionResponse: {
        readonly functionCallId: string;
        readonly hasValue?: boolean;
        readonly value?: unknown;
        readonly error?: {readonly code: string; readonly message: string};
      };
    }
  | {
      readonly kind: 'error';
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly surfaceId?: string;
        readonly functionCallId?: string;
        readonly path?: string;
        readonly details?: readonly {
          readonly path: string;
          readonly code: string;
          readonly message: string;
        }[];
      };
    }
);

export function encodeComponentEnvelope(comp: WireComponentEnvelope): Uint8Array {
  const w = new ProtoWireWriter();
  const T = ENVELOPE_TAGS.Component;
  w.writeString(T.id, comp.id);
  if (comp.component !== undefined) w.writeString(T.component, comp.component);
  if (comp.catalogId !== undefined) w.writeString(T.catalogId, comp.catalogId);
  if (comp.accessibility !== undefined) {
    w.writeBytes(T.accessibility, encodeAccessibilityAttributes(comp.accessibility));
  }
  if (comp.metadata !== undefined) {
    w.writeBytes(T.metadata, encodeMetadataProto(comp.metadata));
  }
  for (const check of comp.checks ?? []) {
    w.writeBytes(T.checks, encodeCheckRule(check));
  }
  if (comp.typedPayload !== undefined) {
    w.writeBytes(T.typedPayload, encodeAny(comp.typedPayload));
  } else if (comp.properties !== undefined) {
    w.writeBytes(T.properties, encodeProtoStruct(comp.properties));
  }
  return w.finish();
}

export function decodeComponentEnvelope(bytes: Uint8Array): WireComponentEnvelope {
  const r = new ProtoWireReader(bytes);
  const T = ENVELOPE_TAGS.Component;
  let id = '';
  let component: string | undefined;
  let catalogId: string | undefined;
  let accessibility: WireAccessibilityAttributes | undefined;
  let metadata: Record<string, unknown> | undefined;
  const checks: WireCheckRule[] = [];
  let typedPayload: ProtoAny | undefined;
  let properties: Record<string, unknown> | undefined;

  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === T.id && wireType === WireType.LEN) {
      id = r.readString();
    } else if (fieldNumber === T.component && wireType === WireType.LEN) {
      component = r.readString();
    } else if (fieldNumber === T.catalogId && wireType === WireType.LEN) {
      catalogId = r.readString();
    } else if (fieldNumber === T.accessibility && wireType === WireType.LEN) {
      accessibility = decodeAccessibilityAttributes(r.readBytes());
    } else if (fieldNumber === T.metadata && wireType === WireType.LEN) {
      metadata = decodeMetadataProto(r.readBytes());
    } else if (fieldNumber === T.checks && wireType === WireType.LEN) {
      checks.push(decodeCheckRule(r.readBytes()));
    } else if (fieldNumber === T.typedPayload && wireType === WireType.LEN) {
      typedPayload = decodeAny(r.readBytes());
      properties = undefined;
    } else if (fieldNumber === T.properties && wireType === WireType.LEN) {
      properties = decodeProtoStruct(r.readBytes());
      typedPayload = undefined;
    } else {
      r.skipField(wireType);
    }
  }

  return {
    id,
    ...(component !== undefined ? {component} : {}),
    ...(catalogId !== undefined ? {catalogId} : {}),
    ...(accessibility !== undefined ? {accessibility} : {}),
    ...(metadata !== undefined ? {metadata} : {}),
    ...(checks.length > 0 ? {checks} : {}),
    ...(typedPayload !== undefined ? {typedPayload} : {}),
    ...(properties !== undefined ? {properties} : {}),
  };
}

function encodeFunctionError(err: {readonly code: string; readonly message: string}): Uint8Array {
  const w = new ProtoWireWriter();
  w.writeString(ENVELOPE_TAGS.FunctionError.code, err.code);
  w.writeString(ENVELOPE_TAGS.FunctionError.message, err.message);
  return w.finish();
}

function decodeFunctionError(bytes: Uint8Array): {code: string; message: string} {
  const r = new ProtoWireReader(bytes);
  let code = '';
  let message = '';
  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === ENVELOPE_TAGS.FunctionError.code && wireType === WireType.LEN) {
      code = r.readString();
    } else if (fieldNumber === ENVELOPE_TAGS.FunctionError.message && wireType === WireType.LEN) {
      message = r.readString();
    } else {
      r.skipField(wireType);
    }
  }
  return {code, message};
}

export function encodeAgentToRendererMessage(msg: WireAgentToRendererMessage): Uint8Array {
  const w = new ProtoWireWriter();
  const T = ENVELOPE_TAGS.AgentToRendererMessage;
  if (msg.version !== undefined) {
    w.writeString(T.version, msg.version);
  }
  switch (msg.kind) {
    case 'createSurface': {
      const cs = msg.createSurface;
      const CT = ENVELOPE_TAGS.CreateSurface;
      w.writeMessage(T.createSurface, cw => {
        cw.writeString(CT.surfaceId, cs.surfaceId);
        if (cs.catalogId !== undefined) cw.writeString(CT.catalogId, cs.catalogId);
        if (cs.sendDataModel !== undefined) cw.writeBool(CT.sendDataModel, cs.sendDataModel);
        for (const comp of cs.components ?? []) {
          cw.writeBytes(CT.components, encodeComponentEnvelope(comp));
        }
        if (cs.dataModel !== undefined) {
          cw.writeBytes(CT.dataModel, encodeProtoStruct(cs.dataModel));
        }
        if (cs.metadata !== undefined) {
          cw.writeBytes(CT.metadata, encodeMetadataProto(cs.metadata));
        }
        if (cs.rootId !== undefined) cw.writeString(CT.rootId, cs.rootId);
        if (cs.theme !== undefined) {
          cw.writeBytes(CT.theme, encodeProtoStruct(cs.theme));
        }
      });
      break;
    }
    case 'updateComponents': {
      const uc = msg.updateComponents;
      const UT = ENVELOPE_TAGS.UpdateComponents;
      w.writeMessage(T.updateComponents, uw => {
        uw.writeString(UT.surfaceId, uc.surfaceId);
        for (const comp of uc.components) {
          uw.writeBytes(UT.components, encodeComponentEnvelope(comp));
        }
      });
      break;
    }
    case 'updateDataModel': {
      const ud = msg.updateDataModel;
      const DT = ENVELOPE_TAGS.UpdateDataModel;
      w.writeMessage(T.updateDataModel, dw => {
        dw.writeString(DT.surfaceId, ud.surfaceId);
        if (ud.path !== undefined) dw.writeString(DT.path, ud.path);
        if (ud.typedValue !== undefined) {
          dw.writeBytes(DT.typedValue, encodeAny(ud.typedValue));
        } else if (ud.hasValue || ud.value !== undefined) {
          dw.writeBytes(DT.value, encodeProtoValue(ud.value));
        }
      });
      break;
    }
    case 'deleteSurface': {
      w.writeMessage(T.deleteSurface, dw => {
        dw.writeString(ENVELOPE_TAGS.DeleteSurface.surfaceId, msg.deleteSurface.surfaceId);
      });
      break;
    }
    case 'callRendererFunction': {
      const crf = msg.callRendererFunction;
      const FT = ENVELOPE_TAGS.CallRendererFunction;
      w.writeMessage(T.callRendererFunction, fw => {
        if (crf.surfaceId !== undefined) fw.writeString(FT.surfaceId, crf.surfaceId);
        fw.writeString(FT.functionCallId, crf.functionCallId);
        fw.writeBytes(FT.callFunction, encodeFunctionCall(crf.callFunction));
      });
      break;
    }
    case 'agentFunctionResponse': {
      const afr = msg.agentFunctionResponse;
      const RT = ENVELOPE_TAGS.AgentFunctionResponse;
      w.writeMessage(T.agentFunctionResponse, rw => {
        rw.writeString(RT.functionCallId, afr.functionCallId);
        if (afr.error !== undefined) {
          rw.writeBytes(RT.error, encodeFunctionError(afr.error));
        } else if (afr.hasValue || afr.value !== undefined) {
          rw.writeBytes(RT.value, encodeProtoValue(afr.value));
        }
      });
      break;
    }
  }
  return w.finish();
}

export function decodeAgentToRendererMessage(bytes: Uint8Array): WireAgentToRendererMessage {
  const r = new ProtoWireReader(bytes);
  const T = ENVELOPE_TAGS.AgentToRendererMessage;
  let version: string | undefined;
  let decoded: WireAgentToRendererMessage | undefined;

  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === T.version && wireType === WireType.LEN) {
      version = r.readString();
    } else if (fieldNumber === T.createSurface && wireType === WireType.LEN) {
      const cr = new ProtoWireReader(r.readBytes());
      const CT = ENVELOPE_TAGS.CreateSurface;
      let surfaceId = '';
      let catalogId: string | undefined;
      let sendDataModel: boolean | undefined;
      const components: WireComponentEnvelope[] = [];
      let dataModel: Record<string, unknown> | undefined;
      let metadata: Record<string, unknown> | undefined;
      let rootId: string | undefined;
      let theme: Record<string, unknown> | undefined;
      while (cr.hasMore()) {
        const ct = cr.readTag();
        if (ct.fieldNumber === CT.surfaceId && ct.wireType === WireType.LEN) {
          surfaceId = cr.readString();
        } else if (ct.fieldNumber === CT.catalogId && ct.wireType === WireType.LEN) {
          catalogId = cr.readString();
        } else if (ct.fieldNumber === CT.sendDataModel && ct.wireType === WireType.VARINT) {
          sendDataModel = cr.readBool();
        } else if (ct.fieldNumber === CT.components && ct.wireType === WireType.LEN) {
          components.push(decodeComponentEnvelope(cr.readBytes()));
        } else if (ct.fieldNumber === CT.dataModel && ct.wireType === WireType.LEN) {
          dataModel = decodeProtoStruct(cr.readBytes());
        } else if (ct.fieldNumber === CT.metadata && ct.wireType === WireType.LEN) {
          metadata = decodeMetadataProto(cr.readBytes());
        } else if (ct.fieldNumber === CT.rootId && ct.wireType === WireType.LEN) {
          rootId = cr.readString();
        } else if (ct.fieldNumber === CT.theme && ct.wireType === WireType.LEN) {
          theme = decodeProtoStruct(cr.readBytes());
        } else {
          cr.skipField(ct.wireType);
        }
      }
      decoded = {
        kind: 'createSurface',
        createSurface: {
          surfaceId,
          ...(catalogId !== undefined ? {catalogId} : {}),
          ...(sendDataModel !== undefined ? {sendDataModel} : {}),
          ...(components.length > 0 ? {components} : {}),
          ...(dataModel !== undefined ? {dataModel} : {}),
          ...(metadata !== undefined ? {metadata} : {}),
          ...(rootId !== undefined ? {rootId} : {}),
          ...(theme !== undefined ? {theme} : {}),
        },
      };
    } else if (fieldNumber === T.updateComponents && wireType === WireType.LEN) {
      const ur = new ProtoWireReader(r.readBytes());
      const UT = ENVELOPE_TAGS.UpdateComponents;
      let surfaceId = '';
      const components: WireComponentEnvelope[] = [];
      while (ur.hasMore()) {
        const ut = ur.readTag();
        if (ut.fieldNumber === UT.surfaceId && ut.wireType === WireType.LEN) {
          surfaceId = ur.readString();
        } else if (ut.fieldNumber === UT.components && ut.wireType === WireType.LEN) {
          components.push(decodeComponentEnvelope(ur.readBytes()));
        } else {
          ur.skipField(ut.wireType);
        }
      }
      decoded = {kind: 'updateComponents', updateComponents: {surfaceId, components}};
    } else if (fieldNumber === T.updateDataModel && wireType === WireType.LEN) {
      const dr = new ProtoWireReader(r.readBytes());
      const DT = ENVELOPE_TAGS.UpdateDataModel;
      let surfaceId = '';
      let path: string | undefined;
      let hasValue = false;
      let value: unknown = undefined;
      let typedValue: ProtoAny | undefined;
      while (dr.hasMore()) {
        const dt = dr.readTag();
        if (dt.fieldNumber === DT.surfaceId && dt.wireType === WireType.LEN) {
          surfaceId = dr.readString();
        } else if (dt.fieldNumber === DT.path && dt.wireType === WireType.LEN) {
          path = dr.readString();
        } else if (dt.fieldNumber === DT.value && dt.wireType === WireType.LEN) {
          hasValue = true;
          value = decodeProtoValue(dr.readBytes());
          typedValue = undefined;
        } else if (dt.fieldNumber === DT.typedValue && dt.wireType === WireType.LEN) {
          typedValue = decodeAny(dr.readBytes());
          hasValue = false;
          value = undefined;
        } else {
          dr.skipField(dt.wireType);
        }
      }
      decoded = {
        kind: 'updateDataModel',
        updateDataModel: {
          surfaceId,
          ...(path !== undefined ? {path} : {}),
          ...(hasValue ? {hasValue: true, value} : {}),
          ...(typedValue !== undefined ? {typedValue} : {}),
        },
      };
    } else if (fieldNumber === T.deleteSurface && wireType === WireType.LEN) {
      const dr = new ProtoWireReader(r.readBytes());
      let surfaceId = '';
      while (dr.hasMore()) {
        const dt = dr.readTag();
        if (
          dt.fieldNumber === ENVELOPE_TAGS.DeleteSurface.surfaceId &&
          dt.wireType === WireType.LEN
        ) {
          surfaceId = dr.readString();
        } else {
          dr.skipField(dt.wireType);
        }
      }
      decoded = {kind: 'deleteSurface', deleteSurface: {surfaceId}};
    } else if (fieldNumber === T.callRendererFunction && wireType === WireType.LEN) {
      const fr = new ProtoWireReader(r.readBytes());
      const FT = ENVELOPE_TAGS.CallRendererFunction;
      let surfaceId: string | undefined;
      let functionCallId = '';
      let callFunction: WireFunctionCall = {'@call': ''};
      while (fr.hasMore()) {
        const ft = fr.readTag();
        if (ft.fieldNumber === FT.surfaceId && ft.wireType === WireType.LEN) {
          surfaceId = fr.readString();
        } else if (ft.fieldNumber === FT.functionCallId && ft.wireType === WireType.LEN) {
          functionCallId = fr.readString();
        } else if (ft.fieldNumber === FT.callFunction && ft.wireType === WireType.LEN) {
          callFunction = decodeFunctionCall(fr.readBytes());
        } else {
          fr.skipField(ft.wireType);
        }
      }
      decoded = {
        kind: 'callRendererFunction',
        callRendererFunction: {
          ...(surfaceId !== undefined ? {surfaceId} : {}),
          functionCallId,
          callFunction,
        },
      };
    } else if (fieldNumber === T.agentFunctionResponse && wireType === WireType.LEN) {
      const rr = new ProtoWireReader(r.readBytes());
      const RT = ENVELOPE_TAGS.AgentFunctionResponse;
      let functionCallId = '';
      let hasValue = false;
      let value: unknown = undefined;
      let error: {code: string; message: string} | undefined;
      while (rr.hasMore()) {
        const rt = rr.readTag();
        if (rt.fieldNumber === RT.functionCallId && rt.wireType === WireType.LEN) {
          functionCallId = rr.readString();
        } else if (rt.fieldNumber === RT.value && rt.wireType === WireType.LEN) {
          hasValue = true;
          value = decodeProtoValue(rr.readBytes());
          error = undefined;
        } else if (rt.fieldNumber === RT.error && rt.wireType === WireType.LEN) {
          error = decodeFunctionError(rr.readBytes());
          hasValue = false;
          value = undefined;
        } else {
          rr.skipField(rt.wireType);
        }
      }
      decoded = {
        kind: 'agentFunctionResponse',
        agentFunctionResponse: {
          functionCallId,
          ...(hasValue ? {hasValue: true, value} : {}),
          ...(error !== undefined ? {error} : {}),
        },
      };
    } else {
      r.skipField(wireType);
    }
  }

  if (!decoded) {
    throw new A2uiValidationError(
      'AgentToRendererMessage protobuf envelope has no message branch.',
    );
  }
  return version !== undefined ? {...decoded, version} : decoded;
}

export function encodeRendererToAgentMessage(msg: WireRendererToAgentMessage): Uint8Array {
  const w = new ProtoWireWriter();
  const T = ENVELOPE_TAGS.RendererToAgentMessage;
  if (msg.version !== undefined) {
    w.writeString(T.version, msg.version);
  }
  switch (msg.kind) {
    case 'action': {
      const a = msg.action;
      const AT = ENVELOPE_TAGS.ActionMessage;
      w.writeMessage(T.action, aw => {
        aw.writeString(AT.name, a.name);
        aw.writeString(AT.surfaceId, a.surfaceId);
        aw.writeString(AT.sourceComponentId, a.sourceComponentId);
        aw.writeString(AT.timestamp, a.timestamp);
        if (a.context !== undefined) aw.writeBytes(AT.context, encodeProtoStruct(a.context));
        if (a.catalogId !== undefined) aw.writeString(AT.catalogId, a.catalogId);
        if (a.userMessage !== undefined) aw.writeString(AT.userMessage, a.userMessage);
        if (a.metadata !== undefined) aw.writeBytes(AT.metadata, encodeMetadataProto(a.metadata));
      });
      break;
    }
    case 'callAgentFunction': {
      const c = msg.callAgentFunction;
      const CT = ENVELOPE_TAGS.CallAgentFunction;
      w.writeMessage(T.callAgentFunction, cw => {
        cw.writeString(CT.surfaceId, c.surfaceId);
        cw.writeString(CT.functionCallId, c.functionCallId);
        cw.writeBytes(CT.callFunction, encodeFunctionCall(c.callFunction));
      });
      break;
    }
    case 'rendererFunctionResponse': {
      const rfr = msg.rendererFunctionResponse;
      const RT = ENVELOPE_TAGS.RendererFunctionResponse;
      w.writeMessage(T.rendererFunctionResponse, rw => {
        rw.writeString(RT.functionCallId, rfr.functionCallId);
        if (rfr.error !== undefined) {
          rw.writeBytes(RT.error, encodeFunctionError(rfr.error));
        } else if (rfr.hasValue || rfr.value !== undefined) {
          rw.writeBytes(RT.value, encodeProtoValue(rfr.value));
        }
      });
      break;
    }
    case 'error': {
      const e = msg.error;
      const ET = ENVELOPE_TAGS.ErrorMessage;
      const DT = ENVELOPE_TAGS.ErrorDetail;
      w.writeMessage(T.error, ew => {
        ew.writeString(ET.code, e.code);
        ew.writeString(ET.message, e.message);
        if (e.surfaceId !== undefined) ew.writeString(ET.surfaceId, e.surfaceId);
        if (e.functionCallId !== undefined) ew.writeString(ET.functionCallId, e.functionCallId);
        if (e.path !== undefined) ew.writeString(ET.path, e.path);
        for (const d of e.details ?? []) {
          ew.writeMessage(ET.details, dw => {
            dw.writeString(DT.path, d.path);
            dw.writeString(DT.code, d.code);
            dw.writeString(DT.message, d.message);
          });
        }
      });
      break;
    }
  }
  return w.finish();
}

export function decodeRendererToAgentMessage(bytes: Uint8Array): WireRendererToAgentMessage {
  const r = new ProtoWireReader(bytes);
  const T = ENVELOPE_TAGS.RendererToAgentMessage;
  let version: string | undefined;
  let decoded: WireRendererToAgentMessage | undefined;

  while (r.hasMore()) {
    const {fieldNumber, wireType} = r.readTag();
    if (fieldNumber === T.version && wireType === WireType.LEN) {
      version = r.readString();
    } else if (fieldNumber === T.action && wireType === WireType.LEN) {
      const ar = new ProtoWireReader(r.readBytes());
      const AT = ENVELOPE_TAGS.ActionMessage;
      let name = '';
      let surfaceId = '';
      let sourceComponentId = '';
      let timestamp = '';
      let context: Record<string, unknown> | undefined;
      let catalogId: string | undefined;
      let userMessage: string | undefined;
      let metadata: Record<string, unknown> | undefined;
      while (ar.hasMore()) {
        const at = ar.readTag();
        if (at.fieldNumber === AT.name && at.wireType === WireType.LEN) {
          name = ar.readString();
        } else if (at.fieldNumber === AT.surfaceId && at.wireType === WireType.LEN) {
          surfaceId = ar.readString();
        } else if (at.fieldNumber === AT.sourceComponentId && at.wireType === WireType.LEN) {
          sourceComponentId = ar.readString();
        } else if (at.fieldNumber === AT.timestamp && at.wireType === WireType.LEN) {
          timestamp = ar.readString();
        } else if (at.fieldNumber === AT.context && at.wireType === WireType.LEN) {
          context = decodeProtoStruct(ar.readBytes());
        } else if (at.fieldNumber === AT.catalogId && at.wireType === WireType.LEN) {
          catalogId = ar.readString();
        } else if (at.fieldNumber === AT.userMessage && at.wireType === WireType.LEN) {
          userMessage = ar.readString();
        } else if (at.fieldNumber === AT.metadata && at.wireType === WireType.LEN) {
          metadata = decodeMetadataProto(ar.readBytes());
        } else {
          ar.skipField(at.wireType);
        }
      }
      decoded = {
        kind: 'action',
        action: {
          name,
          surfaceId,
          sourceComponentId,
          timestamp,
          ...(context !== undefined ? {context} : {}),
          ...(catalogId !== undefined ? {catalogId} : {}),
          ...(userMessage !== undefined ? {userMessage} : {}),
          ...(metadata !== undefined ? {metadata} : {}),
        },
      };
    } else if (fieldNumber === T.callAgentFunction && wireType === WireType.LEN) {
      const cr = new ProtoWireReader(r.readBytes());
      const CT = ENVELOPE_TAGS.CallAgentFunction;
      let surfaceId = '';
      let functionCallId = '';
      let callFunction: WireFunctionCall = {'@call': ''};
      while (cr.hasMore()) {
        const ct = cr.readTag();
        if (ct.fieldNumber === CT.surfaceId && ct.wireType === WireType.LEN) {
          surfaceId = cr.readString();
        } else if (ct.fieldNumber === CT.functionCallId && ct.wireType === WireType.LEN) {
          functionCallId = cr.readString();
        } else if (ct.fieldNumber === CT.callFunction && ct.wireType === WireType.LEN) {
          callFunction = decodeFunctionCall(cr.readBytes());
        } else {
          cr.skipField(ct.wireType);
        }
      }
      decoded = {
        kind: 'callAgentFunction',
        callAgentFunction: {surfaceId, functionCallId, callFunction},
      };
    } else if (fieldNumber === T.rendererFunctionResponse && wireType === WireType.LEN) {
      const rr = new ProtoWireReader(r.readBytes());
      const RT = ENVELOPE_TAGS.RendererFunctionResponse;
      let functionCallId = '';
      let hasValue = false;
      let value: unknown = undefined;
      let error: {code: string; message: string} | undefined;
      while (rr.hasMore()) {
        const rt = rr.readTag();
        if (rt.fieldNumber === RT.functionCallId && rt.wireType === WireType.LEN) {
          functionCallId = rr.readString();
        } else if (rt.fieldNumber === RT.value && rt.wireType === WireType.LEN) {
          hasValue = true;
          value = decodeProtoValue(rr.readBytes());
          error = undefined;
        } else if (rt.fieldNumber === RT.error && rt.wireType === WireType.LEN) {
          error = decodeFunctionError(rr.readBytes());
          hasValue = false;
          value = undefined;
        } else {
          rr.skipField(rt.wireType);
        }
      }
      decoded = {
        kind: 'rendererFunctionResponse',
        rendererFunctionResponse: {
          functionCallId,
          ...(hasValue ? {hasValue: true, value} : {}),
          ...(error !== undefined ? {error} : {}),
        },
      };
    } else if (fieldNumber === T.error && wireType === WireType.LEN) {
      const er = new ProtoWireReader(r.readBytes());
      const ET = ENVELOPE_TAGS.ErrorMessage;
      const DT = ENVELOPE_TAGS.ErrorDetail;
      let code = '';
      let message = '';
      let surfaceId: string | undefined;
      let functionCallId: string | undefined;
      let path: string | undefined;
      const details: Array<{path: string; code: string; message: string}> = [];
      while (er.hasMore()) {
        const et = er.readTag();
        if (et.fieldNumber === ET.code && et.wireType === WireType.LEN) {
          code = er.readString();
        } else if (et.fieldNumber === ET.message && et.wireType === WireType.LEN) {
          message = er.readString();
        } else if (et.fieldNumber === ET.surfaceId && et.wireType === WireType.LEN) {
          surfaceId = er.readString();
        } else if (et.fieldNumber === ET.functionCallId && et.wireType === WireType.LEN) {
          functionCallId = er.readString();
        } else if (et.fieldNumber === ET.path && et.wireType === WireType.LEN) {
          path = er.readString();
        } else if (et.fieldNumber === ET.details && et.wireType === WireType.LEN) {
          const dr = new ProtoWireReader(er.readBytes());
          let dp = '';
          let dc = '';
          let dm = '';
          while (dr.hasMore()) {
            const dt = dr.readTag();
            if (dt.fieldNumber === DT.path && dt.wireType === WireType.LEN) dp = dr.readString();
            else if (dt.fieldNumber === DT.code && dt.wireType === WireType.LEN)
              dc = dr.readString();
            else if (dt.fieldNumber === DT.message && dt.wireType === WireType.LEN)
              dm = dr.readString();
            else dr.skipField(dt.wireType);
          }
          details.push({path: dp, code: dc, message: dm});
        } else {
          er.skipField(et.wireType);
        }
      }
      decoded = {
        kind: 'error',
        error: {
          code,
          message,
          ...(surfaceId !== undefined ? {surfaceId} : {}),
          ...(functionCallId !== undefined ? {functionCallId} : {}),
          ...(path !== undefined ? {path} : {}),
          ...(details.length > 0 ? {details} : {}),
        },
      };
    } else {
      r.skipField(wireType);
    }
  }

  if (!decoded) {
    throw new A2uiValidationError(
      'RendererToAgentMessage protobuf envelope has no message branch.',
    );
  }
  return version !== undefined ? {...decoded, version} : decoded;
}
