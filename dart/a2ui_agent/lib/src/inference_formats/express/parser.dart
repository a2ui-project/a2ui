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

import '../../parser/parser.dart';
import '../../parser/response_part.dart';
import 'compiler.dart';

/// The tag that opens a direct JSON payload, which this parser does not read.
const String _directJsonOpenTag = '<a2ui-json>';

// The open tag may carry attributes, but `<a2ui-json>` is another format's.
final RegExp _openTag = RegExp(r'<a2ui(?:\s[^>]*)?>', caseSensitive: false);
final RegExp _closeTag = RegExp(r'</a2ui\s*>', caseSensitive: false);
final RegExp _leadingFence = RegExp(r'^```[a-zA-Z-]*\s*');
final RegExp _trailingFence = RegExp(r'\s*```[a-zA-Z-]*$');

/// Reads Express blocks from an LLM response and compiles them into v0.9
/// messages.
class ExpressParser extends Parser {
  /// The first of [catalogs] is the default for a surface that does not name
  /// its catalog.
  ExpressParser(List<SchemaCatalog> catalogs)
    : _compiler = ExpressCompiler(catalogs);

  final ExpressCompiler _compiler;

  /// Splits [content] into text and Express blocks, in the order the model
  /// wrote them.
  ///
  /// A close tag inside a string or a comment does not end a block. Text is
  /// trimmed and dropped when empty, and markdown fences a model wraps around
  /// a block are removed. See `conformance/agent/express/response_parser.yaml`.
  ///
  /// Throws [A2uiParseError] if [content] carries a direct JSON payload.
  @override
  List<RawResponsePart> unwrap(String content) {
    if (content.contains(_directJsonOpenTag)) {
      throw A2uiParseError(
        'The response carries a direct JSON payload ($_directJsonOpenTag); '
        'this parser reads only the Express format.',
        rawContent: content,
      );
    }
    final parts = <RawResponsePart>[];
    var i = 0;
    while (true) {
      final Match? open = _openTag.allMatches(content, i).firstOrNull;
      if (open == null) break;
      _addText(parts, content.substring(i, open.start));
      final int start = open.end;
      final int? end = _blockEnd(content, start);
      if (end == null) {
        parts.add(
          RawA2uiPart(_clean(content.substring(start)), isFinal: false),
        );
        return parts;
      }
      parts.add(RawA2uiPart(_clean(content.substring(start, end))));
      i = _closeTag.matchAsPrefix(content, end)!.end;
    }
    _addText(parts, content.substring(i));
    return parts;
  }

  @override
  List<AgentToRendererMessage> compile(String formatContent) =>
      _compiler.compile(formatContent);
}

void _addText(List<RawResponsePart> parts, String text) {
  final String cleaned = _clean(text);
  if (cleaned.isNotEmpty) parts.add(TextPart(cleaned));
}

String _clean(String text) => text
    .trim()
    .replaceFirst(_leadingFence, '')
    .replaceFirst(_trailingFence, '')
    .trim();

/// The index of the close tag ending the block that starts at [start], or
/// null if the block is not closed.
int? _blockEnd(String content, int start) {
  var i = start;
  while (i < content.length) {
    if (_closeTag.matchAsPrefix(content, i) != null) return i;
    final String c = content[i];
    if (c == '"') {
      i = _stringEnd(content, i);
    } else if (c == '#' || content.startsWith('//', i)) {
      final int end = content.indexOf('\n', i);
      i = end < 0 ? content.length : end;
    } else if (content.startsWith('/*', i)) {
      final int end = content.indexOf('*/', i + 2);
      i = end < 0 ? content.length : end + 2;
    } else {
      i++;
    }
  }
  return null;
}

/// The index just past the string literal whose opening quote is at [quote].
int _stringEnd(String content, int quote) {
  final bool isRaw =
      quote > 0 &&
      (content[quote - 1] == 'r' || content[quote - 1] == 'R') &&
      (quote < 2 || !RegExp('[a-zA-Z0-9_]').hasMatch(content[quote - 2]));
  final delimiter = content.startsWith('"""', quote) ? '"""' : '"';
  int i = quote + delimiter.length;
  while (i < content.length) {
    if (!isRaw && content[i] == r'\') {
      i += 2;
    } else if (content.startsWith(delimiter, i)) {
      return i + delimiter.length;
    } else {
      i++;
    }
  }
  return content.length;
}
