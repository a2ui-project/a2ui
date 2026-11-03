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
  r'`|\$/|a2ui|json|schema|catalog|\bdsl\b|syntax|data ?models?\b'
  r'|data ?bindings?\b|surface ?ids?\b|component ?ids?\b|component tree'
  r'|root component|variable names?\b|createsurface|updatecomponents'
  r'|updatedatamodel|deletesurface',
  caseSensitive: false,
);

final _sentenceEnd = RegExp(r'(?<=[.!?])\s+');

/// Removes the sentences of the model's thinking that are about A2UI.
///
/// An app that shows the model's thinking while the user waits passes each
/// thought through this function, so the user reads about their request and
/// not about the format, its code or its data model. A sentence is removed
/// when it has inline code, a data path such as `$/form/name`, or a protocol
/// term such as A2UI, JSON, schema, catalog or data model. A line that loses
/// every sentence is removed too, along with the blank lines after it. A
/// thought with nothing to remove comes back unchanged.
///
/// The terms also match a sentence about the user's own code or JSON, so an
/// agent whose users ask about code should show the thinking unfiltered.
String removeA2uiThinking(String thinking) {
  final lines = <String>[];
  var afterRemovedLine = false;
  for (final String line in thinking.split('\n')) {
    if (line.trim().isEmpty) {
      if (!afterRemovedLine) lines.add(line);
      continue;
    }
    final List<String> sentences = line.split(_sentenceEnd);
    final List<String> kept = [
      for (final sentence in sentences)
        if (!_a2uiTalk.hasMatch(sentence)) sentence,
    ];
    afterRemovedLine = kept.isEmpty;
    if (kept.length == sentences.length) {
      lines.add(line);
    } else if (kept.isNotEmpty) {
      lines.add(kept.join(' '));
    }
  }
  return lines.join('\n');
}
