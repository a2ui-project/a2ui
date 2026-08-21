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

/**
 * Standard MIME types for A2UI message payloads across JSON and Protobuf transports.
 */
export const MIME_TYPE_A2UI_JSON = 'application/a2ui+json';
export const MIME_TYPE_A2UI_PROTO = 'application/a2ui+proto';
export const MIME_TYPE_PROTO_BYTES = 'application/x-protobuf';
export const LEGACY_MIME_TYPE_JSON = 'application/json+a2ui';

export const ALL_A2UI_MIME_TYPES: readonly string[] = [
  MIME_TYPE_A2UI_JSON,
  MIME_TYPE_A2UI_PROTO,
  MIME_TYPE_PROTO_BYTES,
  LEGACY_MIME_TYPE_JSON,
];

/**
 * Output formatting options for A2UI serializers.
 */
export enum OutputFormat {
  JSON_DICT = 'json_dict',
  JSON_STRING = 'json_string',
  PROTO_MESSAGE = 'proto_message',
  PROTO_BYTES = 'proto_bytes',
}

/**
 * Detected input payload formats.
 */
export enum InputFormat {
  JSON = 'json',
  PROTOBUF_BINARY = 'protobuf_binary',
  PROTOBUF_MESSAGE = 'protobuf_message',
}

/**
 * Checks if a given MIME type is a valid A2UI message MIME type.
 */
export function isA2uiMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return ALL_A2UI_MIME_TYPES.includes(mimeType);
}

/**
 * Checks if a given MIME type represents a Protobuf payload.
 */
export function isProtobufMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return mimeType === MIME_TYPE_A2UI_PROTO || mimeType === MIME_TYPE_PROTO_BYTES;
}
