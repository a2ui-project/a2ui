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

/// Reads the JSON a model writes, which is often almost JSON.
///
/// Both readers accept what a model commonly gets wrong and a strict decoder
/// rejects: a trailing comma before `]` or `}`, and a raw line break or tab
/// inside a string. When the text does not read as it is, they read it again
/// with curly quotes straightened, so a curly quote inside a string that is
/// otherwise valid JSON is kept.
library;

/// Reads the complete JSON document [text].
///
/// Throws [FormatException] if [text] is not a single JSON value.
Object? readJson(String text) {
  try {
    return _Reader(text, null).document();
  } on FormatException {
    final String straight = _straightenQuotes(text);
    if (straight == text) rethrow;
    return _Reader(straight, null).document();
  }
}

/// The messages of a direct JSON payload of which [text] is the start,
/// healed so that each reads as the message it is so far.
///
/// [text] is a list of messages, or a single one. Each message closed by
/// [text] is returned as written. The message still arriving is healed if
/// it can be: the lists and maps it has open are closed, a trailing comma is
/// dropped, and a string still arriving is closed where it stands when it is
/// the value of a key in [progressiveKeys]. It cannot be healed if [text]
/// ends inside any other string, a key, a number or a literal, or after a key
/// with no value yet, since each of those could still become something else;
/// it is then left out.
///
/// A list that is the value of a key in [wholeItemKeys] holds only the items
/// that have closed: an item still arriving is left out of the list rather
/// than healed.
///
/// Returns no messages if [text] cannot be the start of a JSON document.
List<Object?> readPartialMessages(
  String text,
  Set<String> progressiveKeys, {
  Set<String> wholeItemKeys = const {},
}) {
  try {
    return _Reader(text, progressiveKeys, wholeItemKeys).messages();
  } on FormatException {
    final String straight = _straightenQuotes(text);
    if (straight == text) return const [];
    try {
      return _Reader(straight, progressiveKeys, wholeItemKeys).messages();
    } on FormatException {
      return const [];
    }
  }
}

String _straightenQuotes(String text) => text
    .replaceAll('“', '"')
    .replaceAll('”', '"')
    .replaceAll('‘', "'")
    .replaceAll('’', "'");

/// Thrown where the text ends before a value that cannot be healed.
class _Unfinished implements Exception {
  const _Unfinished();
}

class _Reader {
  _Reader(this.text, this.progressiveKeys, [this.wholeItemKeys = const {}]);

  final String text;

  /// The keys whose string value may be closed early, or null when [text]
  /// must be complete.
  final Set<String>? progressiveKeys;

  /// The keys whose list value holds only the items that have closed.
  final Set<String> wholeItemKeys;

  int _i = 0;

  /// Whether the value last read was closed early because [text] ended in
  /// it.
  bool _cut = false;

  bool get _partial => progressiveKeys != null;

  bool get _atEnd => _i >= text.length;

  Object? document() {
    _skipSpace();
    final Object? value = _value(healable: false);
    _skipSpace();
    if (!_atEnd) _fail('unexpected text after the JSON value');
    return value;
  }

  List<Object?> messages() {
    _skipSpace();
    if (_atEnd) return const [];
    if (text[_i] != '[') {
      try {
        final Object? message = _value(healable: false);
        _skipSpace();
        if (!_atEnd) _fail('unexpected text after the JSON value');
        return [message];
      } on _Unfinished {
        return const [];
      }
    }
    _i++;
    final messages = <Object?>[];
    while (true) {
      _skipSpace();
      if (_atEnd) return messages;
      if (text[_i] == ']') {
        _i++;
        _skipSpace();
        if (!_atEnd) _fail('unexpected text after the JSON value');
        return messages;
      }
      try {
        messages.add(_value(healable: false));
      } on _Unfinished {
        return messages;
      }
      _skipSpace();
      if (_atEnd) return messages;
      if (text[_i] == ',') {
        _i++;
      } else if (text[_i] != ']') {
        _fail("expected ',' or ']'");
      }
    }
  }

  /// Reads one value. [healable] says whether a string value may be closed
  /// early, which holds for the value of a progressive key.
  Object? _value({required bool healable}) {
    if (_atEnd) _end();
    final String c = text[_i];
    if (c == '{') return _object();
    if (c == '[') return _array();
    if (c == '"') return _string(healable: healable);
    if (c == '-' || _isDigit(c)) return _number();
    for (final (String word, Object? value) in const [
      ('true', true),
      ('false', false),
      ('null', null),
    ]) {
      if (text.startsWith(word, _i)) {
        _i += word.length;
        return value;
      }
      // A word cut short by the end of the text is still arriving.
      if (_partial && word.startsWith(text.substring(_i))) _end();
    }
    _fail("unexpected character '$c'");
  }

  Map<String, Object?> _object() {
    _i++;
    final map = <String, Object?>{};
    while (true) {
      _skipSpace();
      if (_atEnd) return _healed(map);
      if (text[_i] == '}') {
        _i++;
        return map;
      }
      if (text[_i] != '"') _fail('expected a key');
      final String key = _string(healable: false);
      _skipSpace();
      if (_atEnd) _end();
      if (text[_i] != ':') _fail("expected ':' after key '$key'");
      _i++;
      _skipSpace();
      map[key] =
          !_atEnd && text[_i] == '[' && _partial && wholeItemKeys.contains(key)
          ? _array(wholeItems: true)
          : _value(healable: progressiveKeys?.contains(key) ?? false);
      _skipSpace();
      if (_atEnd) return _healed(map);
      if (text[_i] == ',') {
        _i++;
      } else if (text[_i] != '}') {
        _fail("expected ',' or '}'");
      }
    }
  }

  /// Reads a list. When [wholeItems] is true, an item the text ends in is
  /// left out rather than healed.
  List<Object?> _array({bool wholeItems = false}) {
    _i++;
    final list = <Object?>[];
    while (true) {
      _skipSpace();
      if (_atEnd) return _healed(list);
      if (text[_i] == ']') {
        _i++;
        return list;
      }
      // An item has no key, so a string item is never closed early.
      if (wholeItems) {
        final bool cutBefore = _cut;
        _cut = false;
        final Object? item;
        try {
          item = _value(healable: false);
        } on _Unfinished {
          return _healed(list);
        }
        if (_cut) return _healed(list);
        _cut = cutBefore;
        list.add(item);
      } else {
        list.add(_value(healable: false));
      }
      _skipSpace();
      if (_atEnd) return _healed(list);
      if (text[_i] == ',') {
        _i++;
      } else if (text[_i] != ']') {
        _fail("expected ',' or ']'");
      }
    }
  }

  /// [value] closed where the text ends, which only a partial read allows.
  T _healed<T>(T value) {
    if (!_partial) _end();
    _cut = true;
    return value;
  }

  String _string({required bool healable}) {
    _i++;
    final buffer = StringBuffer();
    while (!_atEnd) {
      final String c = text[_i];
      if (c == '"') {
        _i++;
        return buffer.toString();
      }
      if (c != r'\') {
        buffer.write(c);
        _i++;
        continue;
      }
      if (_i + 1 >= text.length) {
        _i = text.length;
        break;
      }
      final String escaped = text[_i + 1];
      switch (escaped) {
        case '"' || r'\' || '/':
          buffer.write(escaped);
        case 'b':
          buffer.write('\b');
        case 'f':
          buffer.write('\f');
        case 'n':
          buffer.write('\n');
        case 'r':
          buffer.write('\r');
        case 't':
          buffer.write('\t');
        case 'u':
          if (_i + 6 > text.length) {
            _i = text.length;
            continue;
          }
          final int? code = int.tryParse(
            text.substring(_i + 2, _i + 6),
            radix: 16,
          );
          if (code == null) _fail('invalid unicode escape');
          buffer.writeCharCode(code);
          _i += 4;
        default:
          _fail("invalid escape '\\$escaped'");
      }
      _i += 2;
    }
    // The text ended inside the string, possibly inside an escape, which is
    // left out.
    if (healable && _partial) {
      _cut = true;
      return buffer.toString();
    }
    _end();
  }

  num _number() {
    final int start = _i;
    if (text[_i] == '-') _i++;
    while (!_atEnd && _isNumberPart(text[_i])) {
      _i++;
    }
    // A number the text ends in could still gain digits.
    if (_atEnd && _partial) _end();
    final String literal = text.substring(start, _i);
    final num? value = int.tryParse(literal) ?? double.tryParse(literal);
    if (value == null || !_numberPattern.hasMatch(literal)) {
      _fail("invalid number '$literal'");
    }
    if (!value.isFinite) _fail("number '$literal' is out of range");
    return value;
  }

  void _skipSpace() {
    while (!_atEnd && ' \t\n\r'.contains(text[_i])) {
      _i++;
    }
  }

  /// The text ends before the value does.
  Never _end() {
    if (_partial) throw const _Unfinished();
    _fail('unexpected end of the JSON text');
  }

  Never _fail(String reason) =>
      throw FormatException('Invalid JSON: $reason', text, _i);
}

final RegExp _numberPattern = RegExp(
  r'^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$',
);

bool _isDigit(String c) => c.compareTo('0') >= 0 && c.compareTo('9') <= 0;

bool _isNumberPart(String c) => _isDigit(c) || '+-.eE'.contains(c);
