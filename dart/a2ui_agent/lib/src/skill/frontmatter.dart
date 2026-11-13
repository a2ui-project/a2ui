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

import 'dart:convert';

/// The column after which a plain scalar wraps, as PyYAML's default `width`.
///
/// The Python SDK writes the shared skill golden files with PyYAML, so a long
/// description wraps where it does there.
const int _lineWidth = 80;

/// [fields] as YAML block mappings, one top-level key per entry, without the
/// `---` lines around them.
String yamlFrontmatter(Map<String, Object?> fields) => [
  for (final MapEntry(:String key, :Object? value) in fields.entries)
    _entry(key, value, 0),
].join('\n');

String _entry(String key, Object? value, int indent) {
  final prefix = '${' ' * indent}$key:';
  return switch (value) {
    final String text => _string(prefix, text, indent),
    num() || bool() => '$prefix $value',
    null => '$prefix null',
    List<Object?>(isEmpty: true) => '$prefix []',
    final List<Object?> items => [
      prefix,
      for (final Object? item in items) '${' ' * indent}- ${_item(item)}',
    ].join('\n'),
    Map<Object?, Object?>(isEmpty: true) => '$prefix {}',
    final Map<Object?, Object?> map => [
      prefix,
      for (final MapEntry(:Object? key, :Object? value) in map.entries)
        _entry('$key', value, indent + 2),
    ].join('\n'),
    _ => '$prefix ${jsonEncode('$value')}',
  };
}

String _item(Object? item) =>
    item is String && _isPlain(item) ? item : jsonEncode(item);

/// Whether [value] can be written as an unquoted YAML plain scalar that reads
/// back as the same string.
bool _isPlain(String value) =>
    value.isNotEmpty &&
    value.trim() == value &&
    !value.contains(RegExp(r'[\n\r\t]')) &&
    !value.startsWith(RegExp(r'''[-?:,\[\]{}#&*!|>'"%@`]''')) &&
    !RegExp(
      r'^(true|false|null|yes|no|on|off|~)$',
      caseSensitive: false,
    ).hasMatch(value) &&
    !RegExp(r'^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$').hasMatch(value) &&
    !value.contains(': ') &&
    !value.contains(' #');

/// [text] after [prefix], as a plain scalar wrapped at a space once the line
/// passes [_lineWidth], or as a double-quoted one when it cannot be plain.
String _string(String prefix, String text, int indent) {
  if (!_isPlain(text)) return '$prefix ${jsonEncode(text)}';
  final out = StringBuffer('$prefix ');
  int column = prefix.length + 1;
  final String continuation = ' ' * (indent + 2);
  String? previous;
  for (final String word in text.split(' ')) {
    if (previous != null) {
      // PyYAML breaks only at a single space, and keeps a run of them.
      if (word.isNotEmpty && previous.isNotEmpty && column > _lineWidth) {
        out.write('\n$continuation');
        column = continuation.length;
      } else {
        out.write(' ');
        column++;
      }
    }
    out.write(word);
    column += word.length;
    previous = word;
  }
  return out.toString();
}
