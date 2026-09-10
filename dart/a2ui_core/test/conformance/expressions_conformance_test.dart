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

import 'dart:io';

import 'package:a2ui_core/src/primitives/errors.dart';
import 'package:a2ui_core/src/processing/expressions.dart';
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

/// Suite-level error categories mapped onto this SDK's exception types.
const Map<String, Type> _categoryToError = {'ParseError': A2uiExpressionError};

/// Walks up from the working directory until it finds the shared suite.
File _findSuite(String relativePath) {
  Directory dir = Directory.current;
  while (true) {
    final candidate = File('${dir.path}/$relativePath');
    if (candidate.existsSync()) return candidate;
    final Directory parent = dir.parent;
    if (parent.path == dir.path) {
      throw StateError('Could not find conformance suite $relativePath');
    }
    dir = parent;
  }
}

/// Converts the YAML document into plain Dart collections.
Object? _plain(Object? node) {
  if (node is YamlMap) {
    return node.map((key, value) => MapEntry(key.toString(), _plain(value)));
  }
  if (node is YamlList) {
    return node.map(_plain).toList();
  }
  return node;
}

/// Joins adjacent literal parts and drops empty ones.
///
/// A template fixes which values a parser produces, not how it happens to
/// split the literal text around them, so both are compared in joined form.
/// An empty literal carries no content either way, and implementations differ
/// on whether they emit one, so it is not something a case should pin.
List<Object?> _joinLiterals(List<Object?> parts) {
  final joined = <Object?>[];
  for (final part in parts) {
    if (part is String && joined.isNotEmpty && joined.last is String) {
      joined[joined.length - 1] = (joined.last as String) + part;
    } else {
      joined.add(part);
    }
  }
  return joined.where((p) => p != '').toList();
}

void main() {
  final File suite = _findSuite('conformance/core/expressions.yaml');
  final cases = _plain(loadYaml(suite.readAsStringSync())) as List<Object?>;

  group('expression parser conformance', () {
    late ExpressionParser parser;

    setUp(() {
      parser = ExpressionParser();
    });

    for (final entry in cases) {
      final testCase = entry as Map<String, Object?>;
      final name = testCase['name'] as String;
      final input = testCase['input'] as String;
      final Object? expectError = testCase['expect_error'];

      test(name, () {
        if (expectError != null) {
          final error = expectError as Map<String, Object?>;
          final category = error['category'] as String;
          final String message = error['message'] as String? ?? '';
          final Type expectedType =
              _categoryToError[category] ?? A2uiExpressionError;

          expect(
            () => parser.parse(input),
            throwsA(
              predicate(
                (Object? e) =>
                    e.runtimeType == expectedType &&
                    RegExp(message).hasMatch(e.toString()),
                'throws $expectedType matching "$message"',
              ),
            ),
          );
          return;
        }

        final expected = testCase['expect'] as List<Object?>;
        expect(_joinLiterals(parser.parse(input)), equals(expected));
      });
    }
  });
}
