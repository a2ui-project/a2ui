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
final RegExp _streamTrailingFence = RegExp(r'\s*`{1,3}[a-zA-Z-]*\s*$');

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

/// The start of a block, with a leading markdown fence removed once its line
/// is complete, and a trailing one removed.
String cleanStart(String block) {
  String text = block.trimLeft();
  if (text.startsWith('`')) {
    final int newline = text.indexOf('\n');
    if (newline < 0) return '';
    text = text.substring(newline + 1);
  }
  return text.replaceFirst(_streamTrailingFence, '');
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
BlockScan scanBlock(String content, int start) {
  var i = start;
  var inString = false;
  while (i < content.length) {
    final String c = content[i];
    if (inString) {
      if (c == r'\') {
        i += 2;
        continue;
      }
      if (c == '"') inString = false;
    } else if (c == '"') {
      inString = true;
    } else if (c == '<') {
      if (closeTag.matchAsPrefix(content, i) != null) {
        return BlockScan(i, i - start);
      }
      final String rest = content.substring(i).toLowerCase();
      if (closeTagText.startsWith(rest) || _closeTagStart.hasMatch(rest)) {
        return BlockScan(null, i - start);
      }
    }
    i++;
  }
  return BlockScan(null, content.length - start);
}
