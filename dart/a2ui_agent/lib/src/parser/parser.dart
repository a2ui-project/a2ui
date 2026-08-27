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

/// Tokenizes LLM output, unwraps format tags, and compiles raw format
/// expressions into A2UI payload messages.
///
/// A parser instance is turn scoped: streaming state accumulated by
/// [parseChunk] belongs to a single LLM response.
abstract class Parser {
  const Parser();

  /// Whether this parser can process streamed chunks via [parseChunk].
  bool get supportsStreaming => false;

  /// Converts raw response parts back into a single string, adding the
  /// format's enclosing tags around each raw A2UI section and concatenating
  /// conversational text parts.
  String wrap(List<RawResponsePart> blocks);

  /// Tokenizes an LLM response into an ordered list of raw parts, extracting
  /// raw format content between sentinel tags while preserving the order in
  /// which the model emitted them.
  ///
  /// Throws [A2uiParseError] if the response contains no well-formed content
  /// for this format.
  List<RawResponsePart> unwrap(String content);

  /// Compiles a raw format content string into validated A2UI messages.
  ///
  /// Throws [A2uiCompileError] if the content cannot be compiled, and
  /// [A2uiValidationError] if the compiled messages are not valid for the
  /// active catalogs or declare an unsupported protocol version.
  List<A2uiMessage> compile(String formatContent);

  /// Decompiles A2UI messages into this format's raw notation.
  String decompile(List<A2uiMessage> a2uiPayload);

  /// Parses a complete, non-streamed LLM response.
  ///
  /// Preserves the chronological order of conversational text and A2UI payload
  /// blocks. When [wrapped] is false the whole of [content] is treated as a
  /// single raw A2UI block.
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
          // Unreachable: RawResponsePart rejects an already compiled part.
          // Matching the concrete type rather than the sealed base keeps this
          // switch exhaustive, so a new ResponsePart subtype is a compile
          // error here rather than a silent fallthrough.
          throw StateError('Unexpected raw part: ${raw.part}');
      }
    }
    return parts;
  }

  /// Processes an incremental chunk of a streamed LLM response.
  ///
  /// Returns only the parts newly completed by this chunk. Buffered, still
  /// incomplete content is retained for the next call.
  List<ResponsePart> parseChunk(String chunk, {bool wrapped = true});
}
