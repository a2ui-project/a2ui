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

/// [fields] as YAML block mappings, one top-level key per entry, without the
/// `---` lines around them.
///
/// Every string, including each key below the top level, is written
/// double-quoted, so a YAML parser reads it back as the same string rather
/// than as a key, a number, a date or a boolean. The top-level keys are the
/// fixed field names of a skill.
String yamlFrontmatter(Map<String, Object?> fields) => [
  for (final MapEntry(:String key, :Object? value) in fields.entries)
    _entry(key, value, 0),
].join('\n');

String _entry(String key, Object? value, int indent) {
  final prefix = '${' ' * indent}$key:';
  return switch (value) {
    num() || bool() => '$prefix $value',
    null => '$prefix null',
    List<Object?>(isEmpty: true) => '$prefix []',
    final List<Object?> items => [
      prefix,
      for (final Object? item in items) '${' ' * indent}- ${_scalar(item)}',
    ].join('\n'),
    Map<Object?, Object?>(isEmpty: true) => '$prefix {}',
    final Map<Object?, Object?> map => [
      prefix,
      for (final MapEntry(:Object? key, :Object? value) in map.entries)
        _entry(_quote('$key'), value, indent + 2),
    ].join('\n'),
    _ => '$prefix ${_scalar(value)}',
  };
}

/// [value] as a flow scalar: a string double-quoted, anything else as JSON,
/// which YAML reads as flow collections and scalars.
String _scalar(Object? value) => switch (value) {
  final String text => _quote(text),
  num() ||
  bool() ||
  null ||
  List<Object?>() ||
  Map<Object?, Object?>() => jsonEncode(value),
  _ => _quote('$value'),
};

/// [text] as a YAML double-quoted scalar.
///
/// A JSON string is one, apart from the characters YAML reads as a line break
/// or does not accept in a document, which are escaped too.
String _quote(String text) => jsonEncode(text).replaceAllMapped(
  RegExp('[\u007f-\u009f\u2028\u2029]'),
  (match) => '\\u${match[0]!.codeUnitAt(0).toRadixString(16).padLeft(4, '0')}',
);
