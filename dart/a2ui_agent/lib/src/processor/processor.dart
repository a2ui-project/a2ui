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

import '../inference_format.dart';
import '../inference_formats/express/format.dart';
import '../parser/response_part.dart';

/// The tag that opens a direct JSON payload, which this processor does not
/// read.
const String _directJsonOpenTag = '<a2ui-json>';

/// The per-request facade: the catalogs negotiated with one renderer, the
/// prompt snippet describing them, and parsing of the LLM's response.
///
/// Usually obtained from `A2uiGenerator.createProcessor`.
class A2uiRequestProcessor {
  /// The catalogs negotiated for this request, in the renderer's preference
  /// order.
  final List<SchemaCatalog> activeCatalogs;

  /// The format the LLM writes payloads in.
  final InferenceFormatFactory formatFactory;

  /// Throws [UnsupportedError] if [formatFactory] is not an
  /// [ExpressFormatFactory], the only format this SDK implements.
  A2uiRequestProcessor({
    required this.activeCatalogs,
    required this.formatFactory,
  }) {
    if (formatFactory is! ExpressFormatFactory) {
      throw UnsupportedError(
        'Unsupported inference format ${formatFactory.runtimeType}; this SDK '
        'supports only ExpressFormatFactory.',
      );
    }
  }

  /// The system prompt snippet teaching the LLM the Express format and the
  /// components and functions of [activeCatalogs].
  ///
  /// The agent adds its own role and workflow instructions around it.
  String get promptSnippet {
    throw UnimplementedError('A2uiRequestProcessor.promptSnippet');
  }

  /// Parses a complete LLM response into text and v0.9 A2UI messages, in the
  /// order the LLM emitted them.
  ///
  /// Throws [A2uiParseError] if [content] carries a payload in a format other
  /// than Express.
  List<ResponsePart> parseResponse(String content) {
    if (content.contains(_directJsonOpenTag)) {
      throw A2uiParseError(
        'The response carries a direct JSON payload ($_directJsonOpenTag); '
        'this processor reads only the Express format.',
        rawContent: content,
      );
    }
    throw UnimplementedError('A2uiRequestProcessor.parseResponse');
  }
}
