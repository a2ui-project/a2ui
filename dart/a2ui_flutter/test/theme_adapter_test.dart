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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('A2uiThemeAdapter', () {
    test('parses 6-digit and 8-digit hex colors', () {
      final Color? color6 = A2uiThemeAdapter.parseHexColor('#1A73E8');
      expect(color6, isNotNull);
      expect(color6!.toARGB32(), 0xFF1A73E8);

      final Color? color8 = A2uiThemeAdapter.parseHexColor('#801A73E8');
      expect(color8, isNotNull);
      expect(color8!.toARGB32(), 0x801A73E8);

      expect(A2uiThemeAdapter.parseHexColor(null), isNull);
      expect(A2uiThemeAdapter.parseHexColor(''), isNull);
      expect(A2uiThemeAdapter.parseHexColor('invalid'), isNull);
    });

    test('applies theme overrides to ThemeData', () {
      final base = ThemeData.light();
      final ThemeData adapted = A2uiThemeAdapter.applyThemeTokens(base, {
        'primaryColor': '#E91E63',
      });
      expect(adapted.colorScheme.primary.toARGB32(), 0xFFE91E63);

      final ThemeData unchanged = A2uiThemeAdapter.applyThemeTokens(
        base,
        const {},
      );
      expect(unchanged, base);
    });
  });
}
