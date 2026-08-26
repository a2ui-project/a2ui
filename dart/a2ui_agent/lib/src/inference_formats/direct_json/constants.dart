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

/// The sentinel tag that opens a DIRECT_JSON payload block.
const String a2uiJsonOpenTag = '<a2ui-json>';

/// The sentinel tag that closes a DIRECT_JSON payload block.
const String a2uiJsonCloseTag = '</a2ui-json>';

/// The tag wrapping catalog schemas in generated system instructions.
const String a2uiSchemaOpenTag = '<a2ui_schema>';

/// The closing counterpart of [a2uiSchemaOpenTag].
const String a2uiSchemaCloseTag = '</a2ui_schema>';

/// String property keys whose values may be auto-closed when a streamed chunk
/// cuts them mid-token.
///
/// These carry display text, so a truncated value renders as partial text
/// rather than as a structural error. Keys outside this set are held back
/// until the stream completes them.
const Set<String> defaultProgressiveKeys = {
  'altText',
  'caption',
  'hint',
  'label',
  'literalString',
  'text',
  'valueString',
};
