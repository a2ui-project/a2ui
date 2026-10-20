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

/// Finding and cleaning `<a2ui-json>` blocks in model output.
library;

import '../../parser/response_part.dart';

/// The open tag, as the prompt asks the model to write it.
const String openTagText = '<a2ui-json>';

/// The close tag, as the prompt asks the model to write it.
const String closeTagText = '</a2ui-json>';

/// The open tag, which may carry attributes, such as
/// `<a2ui-json version="v0.9">`.
final RegExp openTag = RegExp(r'<a2ui-json(?:\s[^>]*)?>', caseSensitive: false);

/// The close tag.
final RegExp closeTag = RegExp(r'</a2ui-json\s*>', caseSensitive: false);

/// The start of an open tag whose end has not arrived: `<a2ui-json` cut
/// anywhere, or followed by attributes.
final RegExp _openTagStart = RegExp(
  r'^<a2ui-json\s[^>]*$',
  caseSensitive: false,
);

final RegExp _closeTagStart = RegExp(r'^</a2ui-json\s*$');

final RegExp _leadingFence = RegExp(r'^```[a-zA-Z-]*\s*');
final RegExp _trailingFence = RegExp(r'\s*```[a-zA-Z-]*$');

/// The index in [text] from which the rest could still become an open tag,
/// or the length of [text].
int possibleTagStart(String text) {
  for (int i = text.indexOf('<'); i >= 0; i = text.indexOf('<', i + 1)) {
    final String rest = text.substring(i);
    if ('<a2ui-json'.startsWith(rest.toLowerCase()) ||
        _openTagStart.hasMatch(rest)) {
      return i;
    }
  }
  return text.length;
}

/// Appends [text] as a text part, unless it is empty once cleaned.
void addText(List<RawResponsePart> parts, String text) {
  final String cleaned = clean(text);
  if (cleaned.isNotEmpty) parts.add(TextPart(cleaned));
}

/// [text] without surrounding whitespace and one markdown fence around it.
String clean(String text) => text
    .trim()
    .replaceFirst(_leadingFence, '')
    .replaceFirst(_trailingFence, '')
    .trim();

bool _isSpace(String text, int i) => text[i].trim().isEmpty;

/// Where the payload of the start of a block that ends at [end] in [text]
/// starts: after leading whitespace, and after the line of a leading
/// markdown fence, or null while that line is not complete.
int? payloadStart(String text, int end) {
  var start = 0;
  while (start < end && _isSpace(text, start)) {
    start++;
  }
  if (start == end || text[start] != '`') return start;
  final int newline = text.indexOf('\n', start);
  return newline < 0 || newline >= end ? null : newline + 1;
}

/// Where the markdown fence that ends the part of [text] from [start] to
/// [end], or the start of one, begins, with the whitespace before it, or
/// [end] if none ends it.
///
/// Finds what `\s*`{1,3}[a-zA-Z-]*\s*$` matches by reading back from the
/// end, since a regular expression would try every offset of a block that
/// is read again on every chunk.
int trailingFenceStart(String text, int start, int end) {
  bool isLanguage(int i) {
    final int c = text.codeUnitAt(i);
    return c == 0x2d || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  }

  var fence = end;
  while (fence > start && _isSpace(text, fence - 1)) {
    fence--;
  }
  while (fence > start && isLanguage(fence - 1)) {
    fence--;
  }
  var ticks = 0;
  while (ticks < 3 && fence > start && text[fence - 1] == '`') {
    fence--;
    ticks++;
  }
  if (ticks == 0) return end;
  while (fence > start && _isSpace(text, fence - 1)) {
    fence--;
  }
  return fence;
}

/// Where a block ends, as [scanBlock] finds it.
class BlockScan {
  const BlockScan(this.closeStart, this.readableEnd);

  /// The index of the close tag ending the block, or null if the block is
  /// not closed.
  final int? closeStart;

  /// The end of the block text that is payload rather than the start of a
  /// close tag, relative to where the block starts. Only meaningful for an
  /// open block.
  final int readableEnd;
}

/// Finds the close tag of the block starting at [start], outside JSON
/// strings.
BlockScan scanBlock(String content, int start) =>
    BlockScanner(start).scan(content);

/// Finds the close tag of a block as its text arrives, reading each
/// character once across the scans of a longer and longer text.
class BlockScanner {
  /// A scanner of the block starting at [_start].
  BlockScanner(this._start) : _i = _start;

  final int _start;

  /// Where the next scan starts, past the end of the text when it ends in
  /// an escape whose second character has not arrived.
  int _i;

  bool _inString = false;

  /// Scans [content], the text the last scan read and more, from where the
  /// last scan stopped.
  BlockScan scan(String content) {
    while (_i < content.length) {
      final String c = content[_i];
      if (_inString) {
        if (c == r'\') {
          _i += 2;
          continue;
        }
        if (c == '"') _inString = false;
      } else if (c == '"') {
        _inString = true;
      } else if (c == '<') {
        if (closeTag.matchAsPrefix(content, _i) != null) {
          return BlockScan(_i, _i - _start);
        }
        final String rest = content.substring(_i).toLowerCase();
        if (closeTagText.startsWith(rest) || _closeTagStart.hasMatch(rest)) {
          // Scanned again from here once more text arrives.
          return BlockScan(null, _i - _start);
        }
      }
      _i++;
    }
    return BlockScan(null, content.length - _start);
  }
}
