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

import 'package:flutter/painting.dart';

/// [markdown] as a span that renders the simple Markdown of the basic `Text`
/// component: emphasis in italics, strong text in bold, strikethrough with a
/// line through it, and code spans in a monospace font.
///
/// Link and image syntax shows its text, heading and quote markers are
/// removed, and backslash escapes show the escaped character. Raw HTML stays
/// text. With [blocks], each heading line takes the [headingStyle] of its
/// level, list items start with a bullet, and blank lines around the text are
/// dropped; without, list markers stay as written.
///
/// The span has no children when none of its text is styled.
TextSpan simpleMarkdown(
  String markdown, {
  required bool blocks,
  required TextStyle? Function(int level) headingStyle,
}) {
  final String literal = markdown.replaceAllMapped(_literal, (m) {
    final String hidden = _hide(m[1] ?? m[2]!);
    return m[1] == null ? hidden : '$_code$hidden$_code';
  });
  String text = _markLines(literal, blocks: blocks);
  for (final (RegExp marker, String? toggle) in _inlineMarkers) {
    text = text.replaceAllMapped(
      marker,
      (m) => toggle == null ? m[1]! : '$toggle${m[1]!}$toggle',
    );
  }
  return _span(text, headingStyle);
}

/// [text] with each line's heading and quote markers removed and, with
/// [blocks], its headings marked by level and list markers replaced by
/// [_bullet].
String _markLines(String text, {required bool blocks}) {
  final List<String> lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    String line = lines[i].replaceFirst(_quote, '');
    if (_heading.firstMatch(line) case final RegExpMatch heading) {
      final String content = _withoutClosingHashes(line.substring(heading.end));
      final int level = heading[1]!.length;
      line = blocks
          ? '${_headingLevel(level)}$content${_headingLevel(0)}'
          : content;
    } else if (blocks) {
      line = line.replaceFirstMapped(_listItem, (m) => '${m[1]}$_bullet');
    }
    lines[i] = line;
  }
  if (!blocks) return lines.join('\n');
  final int start = lines.indexWhere((line) => line.trim().isNotEmpty);
  if (start < 0) return '';
  final int end = lines.lastIndexWhere((line) => line.trim().isNotEmpty);
  return lines.sublist(start, end + 1).join('\n');
}

/// The text of a heading line after its opening `#` markers, without its
/// closing `#` markers and surrounding blanks.
String _withoutClosingHashes(String content) {
  final String trimmed = content.trimRight();
  int end = trimmed.length;
  while (end > 0 && trimmed.codeUnitAt(end - 1) == 0x23) {
    end--;
  }
  if (end == trimmed.length) return trimmed.trim();
  if (end == 0) return '';
  final int before = trimmed.codeUnitAt(end - 1);
  return before == 0x20 || before == 0x09
      ? trimmed.substring(0, end).trim()
      : trimmed.trim();
}

/// The span of [text], whose styles [simpleMarkdown] marked with toggles,
/// heading levels and bullets.
TextSpan _span(String text, TextStyle? Function(int level) headingStyle) {
  final runs = <TextSpan>[];
  final buffer = StringBuffer();
  var strong = false;
  var emphasis = false;
  var strikethrough = false;
  var code = false;
  var level = 0;

  TextStyle? style() {
    if (!strong && !emphasis && !strikethrough && !code && level == 0) {
      return null;
    }
    final TextStyle? heading = level == 0 ? null : headingStyle(level);
    return TextStyle(
      fontSize: heading?.fontSize,
      fontWeight: strong ? FontWeight.bold : heading?.fontWeight,
      fontStyle: emphasis ? FontStyle.italic : null,
      decoration: strikethrough ? TextDecoration.lineThrough : null,
      fontFamily: code ? 'monospace' : null,
      fontFamilyFallback: code ? const ['Courier'] : null,
    );
  }

  void flush() {
    if (buffer.isEmpty) return;
    runs.add(TextSpan(text: buffer.toString(), style: style()));
    buffer.clear();
  }

  for (final int unit in text.codeUnits) {
    if (unit >= _firstHidden && unit <= _lastHidden) {
      buffer.writeCharCode(unit - _hiddenOffset);
    } else if (unit >= _headingLevel0 && unit <= _headingLevel0 + 6) {
      flush();
      level = unit - _headingLevel0;
    } else if (unit == _bulletUnit) {
      flush();
      runs.add(const TextSpan(text: '• ', semanticsLabel: ''));
    } else if (unit == _strongUnit) {
      flush();
      strong = !strong;
    } else if (unit == _emphasisUnit) {
      flush();
      emphasis = !emphasis;
    } else if (unit == _strikethroughUnit) {
      flush();
      strikethrough = !strikethrough;
    } else if (unit == _codeUnit) {
      flush();
      code = !code;
    } else {
      buffer.writeCharCode(unit);
    }
  }
  flush();
  if (runs case [
    TextSpan(style: null, semanticsLabel: null, :final String text),
  ]) {
    return TextSpan(text: text);
  }
  return runs.isEmpty ? const TextSpan(text: '') : TextSpan(children: runs);
}

// The marks [simpleMarkdown] puts in the text, each a character from the
// private use area below the characters [_hide] uses. Each toggle starts and
// ends a style, and each heading level mark sets the level of the text after
// it, 0 for none.
const int _codeUnit = 0xE001;
const int _strongUnit = 0xE002;
const int _emphasisUnit = 0xE003;
const int _strikethroughUnit = 0xE004;
const int _bulletUnit = 0xE005;
const int _headingLevel0 = 0xE010;
final String _code = String.fromCharCode(_codeUnit);
final String _bullet = String.fromCharCode(_bulletUnit);
String _headingLevel(int level) => String.fromCharCode(_headingLevel0 + level);

/// The start of a line that is a Markdown heading, with its `#` markers in
/// group 1.
final RegExp _heading = RegExp(r'^ {0,3}(#{1,6})(?:[ \t]|$)');

/// The quote marker at the start of a line.
final RegExp _quote = RegExp(r'^ {0,3}>[ \t]?');

/// The marker at the start of a bullet list item, with its indent in group 1.
final RegExp _listItem = RegExp(r'^( *)[-*+][ \t]+');

/// The inline markers [simpleMarkdown] removes, each with the toggle of the
/// style of the text it keeps in group 1, or null for none. None of the
/// patterns backtracks over more than one line.
final List<(RegExp, String?)> _inlineMarkers = [
  (RegExp(r'!?\[([^\[\]\n]*)\]\([^()\[\]\n]*\)'), null),
  (RegExp(r'\*\*(.+?)\*\*'), String.fromCharCode(_strongUnit)),
  (RegExp(r'__(.+?)__'), String.fromCharCode(_strongUnit)),
  (RegExp(r'~~(.+?)~~'), String.fromCharCode(_strikethroughUnit)),
  (
    RegExp(r'(?<![\w*])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![\w*])'),
    String.fromCharCode(_emphasisUnit),
  ),
  (
    RegExp(r'(?<!\w)_(?![\s_])([^_\n]+?)(?<![\s_])_(?!\w)'),
    String.fromCharCode(_emphasisUnit),
  ),
];

/// A code span, with its text in group 1, or a backslash escape, with the
/// escaped character in group 2.
final RegExp _literal = RegExp(r'`([^`\n]+)`|\\([!-/:-@\[-`{-~])');

/// An ASCII punctuation character.
final RegExp _punctuation = RegExp(r'[!-/:-@\[-`{-~]');

/// [text] with its ASCII punctuation moved into the private use area, out of
/// reach of the Markdown markers.
String _hide(String text) => text.replaceAllMapped(
  _punctuation,
  (p) => String.fromCharCode(p[0]!.codeUnitAt(0) + _hiddenOffset),
);

/// How far [_hide] moves a character.
const int _hiddenOffset = 0xE000;

/// The range of characters [_hide] produces.
const int _firstHidden = 0x21 + _hiddenOffset;
const int _lastHidden = 0x7E + _hiddenOffset;
