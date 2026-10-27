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
final RegExp _leadingFence = RegExp(
  r'^```[a-zA-Z0-9_-]*\s*',
  caseSensitive: false,
);
final RegExp _trailingFence = RegExp(
  r'\s*```[a-zA-Z0-9_-]*$',
  caseSensitive: false,
);
final RegExp _openFence = RegExp(
  r'^[ \t]*```[a-zA-Z0-9_-]*[ \t]*\r?\n?',
  multiLine: true,
);
final RegExp _closingFenceEnd = RegExp(r'\r?\n?[ \t]*```[ \t]*\r?\n?$');
final RegExp _payloadStart = RegExp(
  r'^[ \t]*(?:surface\s*\(|deleteSurface\s*\(|\$[a-zA-Z0-9_/]*\s*=(?!=)|[a-zA-Z_][a-zA-Z0-9_]*\s*=(?!=))',
  multiLine: true,
);
final RegExp _onlyBackticks = RegExp(r'^`*$');
final RegExp _edgeBackticks = RegExp(r'^`+|`+$');

// The tokens of `Express.g4` a close tag can sit inside, strings and comments,
// and those that hold an `r` or a `//` starting neither. Where several match,
// the first is the longest, which is the one the lexer reads.
final RegExp _token = RegExp(
  r'[rR]"""[\s\S]*?"""' // RAW_TRIPLE_STRING
  r'|[rR]"[^\r\n"]*"' // RAW_STRING
  r'|"""(?:\\[\s\S]|[^\\])*?"""' // TRIPLE_STRING
  r'|"(?:\\[\s\S]|[^\\])*?"' // STANDARD_STRING
  r'|(?:#|//|--)[^\r\n]*' // COMMENT
  r'|/\*[\s\S]*?\*/' // BLOCK_COMMENT
  r'|\$[a-zA-Z0-9_/]*' // PATH
  r'|\?[\p{XID_Start}_]\p{XID_Continue}*' // CHECK
  r'|[\p{XID_Start}_]\p{XID_Continue}*', // IDENTIFIER, and the words the grammar reserves
  unicode: true,
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
    if (!complete && _openTag.hasMatch(content)) return true;
    return unwrap(
      content,
    ).any((RawResponsePart p) => p is RawA2uiPart && (!complete || p.isFinal));
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
  /// A close tag inside a string does not end a block. Text is trimmed and
  /// dropped when empty, and markdown fences a model wraps around a block are
  /// removed, as are the backticks left at a block's edges when a model writes
  /// the tags as inline code. At most one block whose `<a2ui>` open tag was
  /// omitted before `</a2ui>` is recovered in one-shot parsing. Tags of another
  /// format are text. See `conformance/agent/express/response_parser.yaml`.
  @override
  List<RawResponsePart> unwrap(String content) {
    final parts = <RawResponsePart>[];
    var i = 0;
    var recoveredUnmatched = false;
    while (i < content.length) {
      final Match? open = _openTag.allMatches(content, i).firstOrNull;
      final int searchEnd = open?.start ?? content.length;
      if (!recoveredUnmatched && searchEnd > i) {
        final int? nextI = _tryRecoverUnmatchedClose(
          parts,
          content,
          i,
          searchEnd,
        );
        if (nextI != null) {
          recoveredUnmatched = true;
          i = nextI;
          continue;
        }
      }
      if (open == null) break;
      _addText(parts, content.substring(i, open.start));
      final int start = open.end;
      final int? end = _blockEnd(content, start);
      if (end == null) {
        parts.add(
          RawA2uiPart(_cleanRaw(content.substring(start)), isFinal: false),
        );
        return parts;
      }
      parts.add(RawA2uiPart(_cleanRaw(content.substring(start, end))));
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

int? _tryRecoverUnmatchedClose(
  List<RawResponsePart> parts,
  String content,
  int start,
  int searchEnd,
) {
  final String segment = content.substring(start, searchEnd);
  if (!_closeTag.hasMatch(segment)) return null;

  final List<Match> fences = _openFence.allMatches(segment).toList();
  for (var idx = 0; idx < fences.length; idx += 2) {
    final Match fence = fences[idx];
    final int? closeStart = _blockEnd(segment, fence.end);
    if (closeStart == null) continue;
    final String body = segment.substring(fence.end, closeStart);
    final String bodyStripped = body.replaceFirst(_closingFenceEnd, '');
    if (_openFence.hasMatch(bodyStripped)) continue;
    final String rawContent = _cleanRaw(bodyStripped);
    if (rawContent.isEmpty) continue;
    _addText(parts, segment.substring(0, fence.start));
    parts.add(RawA2uiPart(rawContent));
    return start + _closeTag.matchAsPrefix(segment, closeStart)!.end;
  }

  var searchFrom = 0;
  var pairIdx = 0;
  while (pairIdx + 1 < fences.length) {
    final int closeFenceEnd = fences[pairIdx + 1].end;
    if (_blockEnd(segment, closeFenceEnd) == null) break;
    searchFrom = closeFenceEnd;
    pairIdx += 2;
  }

  final Match? stmtMatch = _payloadStart
      .allMatches(segment, searchFrom)
      .firstOrNull;
  if (stmtMatch == null) return null;
  final int? closeStart = _blockEnd(segment, stmtMatch.start);
  if (closeStart == null) return null;
  final String rawContent = _cleanRaw(
    segment.substring(stmtMatch.start, closeStart),
  );
  if (rawContent.isEmpty) return null;
  _addText(parts, segment.substring(0, stmtMatch.start));
  parts.add(RawA2uiPart(rawContent));
  return start + _closeTag.matchAsPrefix(segment, closeStart)!.end;
}

/// Trims [text] and removes the markdown fences around it. A run made of
/// nothing but backticks is left over from tags written as inline code, so it
/// cleans to an empty string.
String _clean(String text) {
  final String cleaned = text
      .trim()
      .replaceFirst(_leadingFence, '')
      .replaceFirst(_trailingFence, '')
      .trim();
  return _onlyBackticks.hasMatch(cleaned) ? '' : cleaned;
}

/// Cleans a block like [_clean], then removes the backticks at its edges. No
/// Express payload starts or ends with one.
String _cleanRaw(String text) =>
    _clean(text).replaceAll(_edgeBackticks, '').trim();

/// The index of the close tag ending the block that starts at [start], or
/// null if the block is not closed.
///
/// Strings and comments are read as `Express.g4` reads them, so a close tag
/// inside a string or a block comment does not end the block, while a close
/// tag on the same line as a single-line comment still closes the block.
int? _blockEnd(String content, int start) {
  var i = start;
  while (i < content.length) {
    if (_closeTag.matchAsPrefix(content, i) != null) return i;
    if (_token.matchAsPrefix(content, i) case final Match token) {
      if (content.startsWith('#', i) ||
          content.startsWith('//', i) ||
          content.startsWith('--', i)) {
        final Match? inComment = _closeTag.firstMatch(
          content.substring(i, token.end),
        );
        if (inComment != null) return i + inComment.start;
      }
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
