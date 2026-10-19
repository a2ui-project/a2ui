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

/// One message of a payload still arriving: the message as it reads so far,
/// and whether its JSON value has closed.
typedef PartialMessage = ({Object? message, bool closed});

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
/// Only the part of [text] from [start] to [end], by default all of it, is
/// read.
///
/// Given a [cache] that earlier reads of the same payload filled, a list or
/// map that closed in one of them is taken from it rather than read again,
/// as the same object, and a list still open is read on from its last item
/// that closed. A caller must not change the lists and maps returned.
///
/// Returns no messages if [text] cannot be the start of a JSON document.
List<PartialMessage> readPartialMessages(
  String text,
  Set<String> progressiveKeys, {
  Set<String> wholeItemKeys = const {},
  PartialReadCache? cache,
  int start = 0,
  int? end,
}) {
  List<PartialMessage> read(String text, _ReadState? state) => _Reader(
    text,
    progressiveKeys,
    wholeItemKeys,
    state,
    start,
    end,
  ).messages();

  try {
    return read(text, cache?._plain);
  } on FormatException {
    final String straight = _straightenQuotes(text);
    if (straight == text) return const [];
    try {
      return read(straight, cache?._straight);
    } on FormatException {
      return const [];
    }
  }
}

/// What the reads of a payload as it arrives keep, so that each read of more
/// of it reads only what the earlier ones left open.
///
/// Every read through a cache must start at the same offset, and read a text
/// that holds the same characters as the earlier ones wherever both reach,
/// and that reaches the end of every list or map they read: the direct JSON
/// parser reads a block that only grows, less any markdown fence at its end.
class PartialReadCache {
  final _ReadState _plain = _ReadState();

  /// The state of the reads of the text with curly quotes straightened,
  /// which has the same offsets.
  final _ReadState _straight = _ReadState();
}

class _ReadState {
  /// Each list or map that closed, by the offset of its opening bracket,
  /// with the offset after its closing one.
  final Map<int, (Object?, int)> closed = {};

  /// Each list still open, by the offset of its opening bracket, with the
  /// items that closed and the offset after the last of them.
  final Map<int, (List<Object?>, int)> open = {};
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
  _Reader(
    this.text,
    this.progressiveKeys, [
    this.wholeItemKeys = const {},
    this._state,
    int start = 0,
    int? end,
  ]) : _i = start,
       _limit = end ?? text.length;

  final String text;

  /// The keys whose string value may be closed early, or null when [text]
  /// must be complete.
  final Set<String>? progressiveKeys;

  /// The keys whose list value holds only the items that have closed.
  final Set<String> wholeItemKeys;

  /// What earlier reads of [text] found, as [PartialReadCache] keeps it, or
  /// null.
  final _ReadState? _state;

  int _i;

  /// Where the part of [text] being read ends.
  final int _limit;

  /// Whether the value last read was closed early because [text] ended in
  /// it.
  bool _cut = false;

  bool get _partial => progressiveKeys != null;

  bool get _atEnd => _i >= _limit;

  Object? document() {
    _skipSpace();
    final Object? value = _value(healable: false);
    _skipSpace();
    if (!_atEnd) _fail('unexpected text after the JSON value');
    return value;
  }

  List<PartialMessage> messages() {
    _skipSpace();
    if (_atEnd) return const [];
    if (text[_i] != '[') {
      try {
        final PartialMessage message = _message();
        _skipSpace();
        if (!_atEnd) _fail('unexpected text after the JSON value');
        return [message];
      } on _Unfinished {
        return const [];
      }
    }
    _i++;
    final messages = <PartialMessage>[];
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
        messages.add(_message());
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

  /// Reads one message, noting whether the text closed it or it was healed.
  PartialMessage _message() {
    _cut = false;
    final Object? message = _value(healable: false);
    return (message: message, closed: !_cut);
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
      if (_i + word.length <= _limit && text.startsWith(word, _i)) {
        _i += word.length;
        return value;
      }
      // A word cut short by the end of the text is still arriving.
      if (_partial && word.startsWith(text.substring(_i, _limit))) _end();
    }
    _fail("unexpected character '$c'");
  }

  Map<String, Object?> _object() => _closedOr(_readObject);

  /// Reads a list or map through [read], unless an earlier read saw the one
  /// that starts here close, and keeps it if it closes.
  T _closedOr<T>(T Function() read) {
    final Map<int, (Object?, int)>? closedValues = _state?.closed;
    if (closedValues == null) return read();
    final int start = _i;
    if (closedValues[start] case (final Object? value, final int end)) {
      _i = end;
      return value as T;
    }
    final bool cutBefore = _cut;
    _cut = false;
    final T value = read();
    if (!_cut) closedValues[start] = (value, _i);
    _cut = cutBefore || _cut;
    return value;
  }

  Map<String, Object?> _readObject() {
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
  List<Object?> _array({bool wholeItems = false}) =>
      _closedOr(() => _readArray(wholeItems: wholeItems));

  List<Object?> _readArray({required bool wholeItems}) {
    final int start = _i;
    _i++;
    var list = <Object?>[];
    // How many of the items closed, and where the text after the last of
    // them starts, for the next read to go on from.
    var closedItems = 0;
    int resume = _i;
    var afterItem = false;
    if (_state?.open[start] case (final List<Object?> items, final int at)) {
      list = [...items];
      closedItems = items.length;
      resume = _i = at;
      afterItem = items.isNotEmpty;
    }

    List<Object?> healed() {
      _state?.open[start] = (
        closedItems == list.length ? list : list.sublist(0, closedItems),
        resume,
      );
      return _healed(list);
    }

    while (true) {
      if (afterItem) {
        _skipSpace();
        if (_atEnd) return healed();
        if (text[_i] == ',') {
          _i++;
        } else if (text[_i] != ']') {
          _fail("expected ',' or ']'");
        }
      }
      afterItem = true;
      _skipSpace();
      if (_atEnd) return healed();
      if (text[_i] == ']') {
        _i++;
        _state?.open.remove(start);
        return list;
      }
      final bool cutBefore = _cut;
      _cut = false;
      // An item has no key, so a string item is never closed early.
      final Object? item;
      if (wholeItems) {
        try {
          item = _value(healable: false);
        } on _Unfinished {
          return healed();
        }
        if (_cut) return healed();
      } else {
        item = _value(healable: false);
      }
      list.add(item);
      // An item closed early ends the text, so the list closes early too.
      if (_cut) continue;
      _cut = cutBefore;
      closedItems = list.length;
      resume = _i;
    }
  }

  /// [value] closed where the text ends, which only a partial read allows.
  T _healed<T>(T value) {
    if (!_partial) _end();
    _cut = true;
    return value;
  }

  /// The start of a `\uXXXX` escape cut short, or nothing.
  static final RegExp _cutEscape = RegExp(r'^(\\(u[0-9a-fA-F]{0,3})?)?$');

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
      if (_i + 1 >= _limit) {
        _i = _limit;
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
          if (_i + 6 > _limit) {
            _i = _limit;
            continue;
          }
          final int? code = int.tryParse(
            text.substring(_i + 2, _i + 6),
            radix: 16,
          );
          if (code == null) _fail('invalid unicode escape');
          // The high half of a surrogate pair, with the text ending where
          // the low half's escape may begin, is left out with it.
          if (code >= 0xD800 &&
              code <= 0xDBFF &&
              _cutEscape.hasMatch(text.substring(_i + 6, _limit))) {
            _i = _limit;
            continue;
          }
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
