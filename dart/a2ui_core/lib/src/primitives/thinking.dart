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

// Inline code, a data path, or a term that only comes up when the model thinks
// about the protocol. A bare "surface" or "component" is left out, since the
// user's request may well be about a kitchen surface or a dishwasher component.
final _a2uiTalk = RegExp(
  r'`|\$/|\ba2ui|\bjson|\bschemas?\b|\bcatalogs?\b|\bdsl\b|\bsyntax\b'
  r'|\bdata ?models?\b|\bdata ?bindings?\b|\bsurface ?ids?\b'
  r'|\bcomponent ?ids?\b|\bcomponent trees?\b|\broot components?\b'
  r'|\bvariable names?\b|\bcreatesurface\b|\bupdatecomponents\b'
  r'|\bupdatedatamodel\b|\bdeletesurface\b',
  caseSensitive: false,
);

// The whitespace after a sentence: after `.`, `!` or `?`, and any closing
// emphasis, quotes or brackets, as in `**Done.** Next`.
final _sentenceEnd = RegExp(
  r'''(?<=[.!?])\s+|(?<=[.!?][*_"')\]])\s+|(?<=[.!?][*_"')\]]{2})\s+''',
);

final _listMarker = RegExp(r'^\s*(?:[-*+]|\d+[.)])\s+');

final _a2uiTagLine = RegExp(r'^\s*<a2ui(?:-json)?>\s*$', caseSensitive: false);

/// Removes the sentences of the model's thinking that are about A2UI.
///
/// An app that shows the model's thinking while the user waits passes each
/// thought through this function, so the user reads about their request and
/// not about the format, its code or its data model. A sentence is removed
/// when it has inline code, a data path such as `$/form/name`, or a protocol
/// term such as A2UI, JSON, schema, catalog or data model. A fenced code block,
/// or a block between `<a2ui>` and `</a2ui>` lines, is removed whole. A line
/// that loses every sentence is removed too, along with the blank lines after
/// it. A thought with nothing to remove comes back unchanged.
///
/// The terms also match a sentence about the user's own code or JSON, so an
/// agent whose users ask about code should show the thinking unfiltered.
String removeA2uiThinking(String thinking) {
  final lines = <String>[];
  var afterRemovedLine = false;
  String? blockEnd;
  for (final String line in thinking.split('\n')) {
    final cr = line.endsWith('\r') ? '\r' : '';
    final String text = cr.isEmpty ? line : line.substring(0, line.length - 1);
    if (blockEnd != null) {
      if (text.toLowerCase().contains(blockEnd)) blockEnd = null;
      afterRemovedLine = true;
      continue;
    }
    if (text.trimLeft().startsWith('```')) {
      if ('```'.allMatches(text).length == 1) blockEnd = '```';
      afterRemovedLine = true;
      continue;
    }
    if (_a2uiTagLine.hasMatch(text)) {
      blockEnd = '</a2ui';
      afterRemovedLine = true;
      continue;
    }
    if (text.trim().isEmpty) {
      if (!afterRemovedLine) lines.add(line);
      continue;
    }
    final String prefix = _listMarker.matchAsPrefix(text)?.group(0) ?? '';
    final List<String> sentences = [
      for (final String sentence
          in text.substring(prefix.length).split(_sentenceEnd))
        if (sentence.isNotEmpty) sentence,
    ];
    final List<String> kept = [
      for (final sentence in sentences)
        if (!_a2uiTalk.hasMatch(sentence)) sentence,
    ];
    afterRemovedLine = kept.isEmpty;
    if (kept.length == sentences.length) {
      lines.add(line);
    } else if (kept.isNotEmpty) {
      lines.add(prefix + kept.join(' ') + cr);
    }
  }
  return lines.join('\n');
}
