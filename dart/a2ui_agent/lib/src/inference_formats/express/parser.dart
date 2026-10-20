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
import 'decompiler.dart';

// The open tag may carry attributes. `<a2ui-json>` does not match, so a
// block in another format is read as text.
final RegExp _openTag = RegExp(r'<a2ui(?:\s[^>]*)?>', caseSensitive: false);
final RegExp _closeTag = RegExp(r'</a2ui\s*>', caseSensitive: false);
final RegExp _leadingFence = RegExp(r'^```[a-zA-Z-]*\s*');
final RegExp _trailingFence = RegExp(r'\s*```[a-zA-Z-]*$');

// The tokens of `Express.g4` a close tag can sit inside, strings and comments,
// and those that hold an `r` or a `//` starting neither. Where several match,
// the first is the longest, which is the one the lexer reads.
final RegExp _token = RegExp(
  r'[rR]"""[\s\S]*?"""' // RAW_TRIPLE_STRING
  r'|[rR]"[^\r\n"]*"' // RAW_STRING
  r'|"""(?:\\[\s\S]|[^\\])*?"""' // TRIPLE_STRING
  r'|"(?:\\[\s\S]|[^\\])*?"' // STANDARD_STRING
  r'|(?:#|//)[^\r\n]*' // COMMENT
  r'|/\*[\s\S]*?\*/' // BLOCK_COMMENT
  r'|\$[a-zA-Z0-9_/]*' // PATH
  r'|\?[a-zA-Z_][a-zA-Z0-9_]*' // CHECK
  r'|[a-zA-Z_][a-zA-Z0-9_]*', // IDENTIFIER, and the words the grammar reserves
);

/// Reads Express blocks from an LLM response and compiles them into messages
/// of the protocol version the catalogs target.
///
/// The compiler checks each component against the schema it reads the
/// component's arguments with. [parseResponse] checks the messages against a
/// renderer state, as for any format.
///
/// Finding, wrapping and unwrapping blocks does not depend on the version.
class ExpressParser extends Parser {
  /// The first of [catalogs] is the default for a surface that does not name
  /// its catalog.
  ExpressParser(List<CatalogApi> catalogs)
    : catalogs = List.unmodifiable(catalogs),
      _compiler = ExpressCompiler(catalogs),
      _decompiler = ExpressDecompiler(catalogs);

  @override
  final List<CatalogApi> catalogs;

  final ExpressCompiler _compiler;
  final ExpressDecompiler _decompiler;

  /// Whether [content] carries an `<a2ui>` block, closed when [complete] is
  /// true.
  @override
  bool hasFormatContent(String content, {bool complete = false}) {
    final Match? open = _openTag.firstMatch(content);
    if (open == null) return false;
    return !complete || _blockEnd(content, open.end) != null;
  }

  /// Writes each part on its own line, with the `<a2ui>` and `</a2ui>` tags
  /// on lines of their own. See
  /// `conformance/agent/express/response_parser.yaml`.
  @override
  String wrap(List<RawResponsePart> parts) => [
    for (final RawResponsePart part in parts)
      switch (part) {
        TextPart(:final String text) => text,
        RawA2uiPart(:final String a2uiRaw) => '<a2ui>\n$a2uiRaw\n</a2ui>',
      },
  ].join('\n');

  /// Splits [content] into text and Express blocks, in the order the model
  /// wrote them.
  ///
  /// A close tag inside a string or a comment does not end a block. Text is
  /// trimmed and dropped when empty, and markdown fences a model wraps around
  /// a block are removed. Tags of another format are text. See
  /// `conformance/agent/express/response_parser.yaml`.
  @override
  List<RawResponsePart> unwrap(String content) {
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

  @override
  String decompile(List<AgentToRendererMessage> a2uiPayload) =>
      _decompiler.decompile(a2uiPayload);
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
///
/// Strings and comments are read as `Express.g4` reads them, so a close tag
/// inside one does not end the block.
int? _blockEnd(String content, int start) {
  var i = start;
  while (i < content.length) {
    if (_closeTag.matchAsPrefix(content, i) != null) return i;
    if (_token.matchAsPrefix(content, i) case final Match token) {
      i = token.end;
    } else if (content.startsWith('"', i) || content.startsWith('/*', i)) {
      // A string or a block comment that is not closed runs to the end.
      return null;
    } else {
      i++;
    }
  }
  return null;
}
