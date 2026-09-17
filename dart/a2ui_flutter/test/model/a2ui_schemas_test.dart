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

import 'package:a2ui_flutter/src/model/a2ui_schemas.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/src/schema/schema.dart';

void main() {
  group('A2uiSchemas', () {
    test('clientFunctions schema contains pluralize and openUrl', () {
      final Schema schema = A2uiSchemas.clientFunctions();
      final String jsonStr = schema.toJson();
      final json = jsonDecode(jsonStr) as Map<String, dynamic>;

      expect(json['type'], 'array');
      final items = json['items'] as Map<String, dynamic>;
      expect(items['oneOf'], isA<List<dynamic>>());
      final oneOf = items['oneOf'] as List<dynamic>;

      var hasPluralize = false;
      var hasOpenUrl = false;

      for (final item in oneOf) {
        final itemMap = item as Map<String, dynamic>;
        final properties = itemMap['properties'] as Map<String, dynamic>?;
        if (properties != null) {
          final call = properties['call'] as Map<String, dynamic>?;
          if (call != null) {
            final constValue = call['const'] as String?;
            if (constValue == 'pluralize') {
              hasPluralize = true;
            } else if (constValue == 'openUrl') {
              hasOpenUrl = true;
            }
          }
        }
      }

      expect(hasPluralize, isTrue, reason: 'Missing pluralize function');
      expect(hasOpenUrl, isTrue, reason: 'Missing openUrl function');
    });
  });
}
