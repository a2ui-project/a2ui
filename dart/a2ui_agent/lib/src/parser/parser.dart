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

/// Reads an LLM response written in one inference format.
///
/// Obtained from `InferenceFormat.createParser`, bound to the catalogs of one
/// request.
abstract class Parser {
  const Parser();

  /// Splits [content] into text and raw payload blocks, in the order the LLM
  /// wrote them.
  List<RawResponsePart> unwrap(String content);

  /// Compiles the content of one payload block, without its sentinel tags,
  /// into A2UI messages.
  ///
  /// Throws [A2uiParseError] if [formatContent] cannot be read, and
  /// [A2uiValidationError] if it uses anything the catalogs do not declare.
  List<AgentToRendererMessage> compile(String formatContent);

  /// Parses a complete LLM response into text and A2UI messages, in the order
  /// the LLM emitted them.
  ///
  /// When [wrapped] is false, [content] is a single payload without sentinel
  /// tags and is compiled whole.
  ///
  /// Throws what [unwrap] and [compile] throw.
  List<ResponsePart> parseResponse(String content, {bool wrapped = true}) {
    if (!wrapped) return [A2uiPart(compile(content))];
    return [
      for (final RawResponsePart part in unwrap(content))
        switch (part) {
          TextPart() => part,
          RawA2uiPart(:final String a2uiRaw) => A2uiPart(compile(a2uiRaw)),
        },
    ];
  }
}
