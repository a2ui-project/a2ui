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

import 'package:a2ui_core/a2ui_core.dart';

import 'response_part.dart';

/// Tokenizes LLM output and compiles it into A2UI messages.
///
/// Turn scoped: streaming state from [parseChunk] belongs to one response.
abstract class Parser {
  const Parser();

  /// Whether this parser can process streamed chunks via [parseChunk].
  bool get supportsStreaming => false;

  /// Renders raw parts back to one string, re-adding the format's tags.
  String wrap(List<RawResponsePart> blocks);

  /// Tokenizes a response into raw parts, in the order the model emitted
  /// them.
  ///
  /// Throws [A2uiParseError] if the response holds no well-formed content for
  /// this format.
  List<RawResponsePart> unwrap(String content);

  /// Compiles raw format content into validated A2UI messages.
  ///
  /// Throws [A2uiCompileError] if it cannot be compiled, and
  /// [A2uiValidationError] if the result is invalid for the active catalogs
  /// or declares an unsupported version.
  List<A2uiMessage> compile(String formatContent);

  /// Decompiles A2UI messages into this format's raw notation.
  String decompile(List<A2uiMessage> a2uiPayload);

  /// Parses a complete, non-streamed response, preserving emission order.
  ///
  /// When [wrapped] is false, all of [content] is one raw A2UI block.
  List<ResponsePart> parseResponse(String content, {bool wrapped = true}) {
    if (!wrapped) return [A2uiPart(compile(content))];
    final parts = <ResponsePart>[];
    for (final RawResponsePart raw in unwrap(content)) {
      switch (raw.part) {
        case TextPart(:final String text):
          parts.add(TextPart(text));
        case RawA2uiPart(:final String a2uiRaw):
          parts.add(A2uiPart(compile(a2uiRaw)));
        case A2uiPart():
          // Unreachable: RawResponsePart rejects compiled parts. Matching
          // the concrete type keeps this switch exhaustive, so a new subtype
          // is a compile error rather than a silent fallthrough.
          throw StateError('Unexpected raw part: ${raw.part}');
      }
    }
    return parts;
  }

  /// Processes one chunk of a streamed response.
  ///
  /// Returns the parts this chunk completed; incomplete content is buffered.
  List<ResponsePart> parseChunk(String chunk, {bool wrapped = true});
}
