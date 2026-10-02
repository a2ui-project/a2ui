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

import 'package:flutter/material.dart';

/// Utilities for adapting A2UI JSON theme definitions to Flutter [ThemeData].
class A2uiThemeAdapter {
  /// Parses a hex color string (e.g. `#1A73E8` or `#RRGGBB`) into a [Color].
  static Color? parseHexColor(String? hexString) {
    if (hexString == null || hexString.isEmpty) return null;
    String hex = hexString.replaceAll('#', '').trim();
    if (hex.length == 6) {
      hex = 'FF$hex';
    }
    if (hex.length != 8) return null;
    final int? val = int.tryParse(hex, radix: 16);
    return val != null ? Color(val) : null;
  }

  /// Creates a modified [ThemeData] by applying tokens from [themeTokens]
  /// to [baseTheme].
  static ThemeData applyThemeTokens(
    ThemeData baseTheme,
    Map<String, dynamic> themeTokens,
  ) {
    if (themeTokens.isEmpty) return baseTheme;

    final Color? primaryColor = parseHexColor(
      themeTokens['primaryColor']?.toString(),
    );

    if (primaryColor == null) return baseTheme;

    return baseTheme.copyWith(
      colorScheme: baseTheme.colorScheme.copyWith(primary: primaryColor),
    );
  }
}
